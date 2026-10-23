import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { DEFAULT_SETTINGS, INITIAL_SOURCES } from './catalog';
import { resolveDatabaseConfig } from './database-config';

type Row = Record<string, unknown>;
type SQLite = import('node:sqlite').DatabaseSync;
let sqlite: SQLite | undefined;
let pool: Pool | undefined;
let initialized: Promise<void> | undefined;
let serial = Promise.resolve();
const scope = new AsyncLocalStorage<PoolClient | 'sqlite'>();
async function exclusive<T>(work:()=>Promise<T>):Promise<T> {
  let release!:()=>void;
  const previous = serial;
  serial = new Promise<void>(resolve => { release=resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}
function pgSQL(sql:string) { let index=0; return sql.replace(/\?/g,()=>`$${++index}`); }
const migrations = ['001_schema.sql','003_newsroom.sql','004_sports.sql','005_public_services.sql','006_briefing.sql'];
const privateTables = ['sources','settings','ingested_items','events','generated_summaries','citations','article_versions','editorial_reviews','corrections','pipeline_runs','pipeline_locks','ai_usage','daily_digests','daily_metrics','reports','rate_limits','newsroom_jobs','newsroom_actions','newsroom_verifications','newsroom_runtime','source_health','newsroom_incidents','homepage_overrides','homepage_editions','link_checks','page_metrics','ai_usage_details','public_answer_cache','geographic_units',
  'fuel_imports','fuel_stations','fuel_prices','fuel_history','public_data_runtime','economic_indicators','economic_indicator_versions','civic_measures','municipal_notices','admin_alerts',
  'sports_disciplines','sports_providers','sports_competitions','sports_entities','sports_events','sports_standings','sports_usage','sports_sync_state','sports_audit',
  'ai24_briefings','ai24_briefing_items','ai24_briefing_settings','ai24_briefing_runs','ai24_briefing_audio','ai24_schema_versions'];
async function raw(sql:string, params:unknown[]=[]):Promise<{rows:Row[];changes:number}> {
  if (pool) {
    const connection = scope.getStore();
    const result = await (connection && connection !== 'sqlite' ? connection : pool).query(pgSQL(sql),params);
    return {rows:result.rows || [],changes:result.rowCount || 0};
  }
  if (!sqlite) throw new Error('Database non inizializzato');
  const perform = async () => {
    const statement = sqlite!.prepare(sql);
    const values = params.map(value => value === undefined ? null : value) as import('node:sqlite').SQLInputValue[];
    if (/^\s*(SELECT|WITH|PRAGMA)|\bRETURNING\b/i.test(sql)) return {rows:statement.all(...values) as Row[],changes:0};
    const result=statement.run(...values);
    return {rows:[],changes:Number(result.changes)};
  };
  return scope.getStore()==='sqlite' ? perform() : exclusive(perform);
}
export async function initDatabase():Promise<void> {
  if (!initialized) initialized = (async()=>{
    const config = resolveDatabaseConfig();
    if (config.kind === 'postgres') pool ??= new Pool(config.pool);
    else if (!sqlite) {
      const dbPath = config.filename;
      if(dbPath!==':memory:') await mkdir(path.dirname(dbPath),{recursive:true});
      const { DatabaseSync } = await import('node:sqlite');
      sqlite = new DatabaseSync(dbPath);
      sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
    }
    const schemas = await Promise.all(migrations.map(async name => ({name, sql:await readFile(path.join(process.cwd(),'migrations',name),'utf8')})));
    const migrate = async () => {
      for(const schema of schemas)for(const sql of schema.sql.split(';').map(part=>part.trim()).filter(Boolean))await raw(sql);
      if(pool){
        // Anonymous and authenticated REST roles get no editorial-table access.
        for(const table of privateTables)await raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        const roles=await raw("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')");
        for(const role of roles.rows)for(const table of privateTables)await raw(`REVOKE ALL ON TABLE ${table} FROM ${String(role.rolname)}`);
      }
      for(const source of INITIAL_SOURCES)await raw('INSERT INTO sources (id,payload) VALUES (?,?) ON CONFLICT(id) DO NOTHING',[source.id,JSON.stringify(source)]);
      await raw('INSERT INTO settings (id,payload) VALUES (?,?) ON CONFLICT(id) DO NOTHING',['global',JSON.stringify(DEFAULT_SETTINGS)]);
    };
    if(!pool){await migrate();return;}

    // Serverless replicas serialize initialization on one transaction-scoped
    // connection. Unchanged deployments read a marker without repeating DDL.
    // Seed changes only insert missing records; existing settings stay intact.
    const version=createHash('sha256').update(JSON.stringify({schemas,privateTables,securityVersion:1,sources:INITIAL_SOURCES,settings:DEFAULT_SETTINGS})).digest('hex');
    const connection=await pool.connect();
    try {
      await connection.query('BEGIN');
      await scope.run(connection,async()=>{
        await raw('SELECT pg_advisory_xact_lock(621240024,1)');
        const registry=await raw("SELECT to_regclass('ai24_schema_versions') AS name");
        if(registry.rows[0]?.name){
          const applied=await raw('SELECT version FROM ai24_schema_versions WHERE version=?',[version]);
          if(applied.rows.length)return;
        }else await raw('CREATE TABLE ai24_schema_versions (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
        await migrate();
        await raw('INSERT INTO ai24_schema_versions (version,applied_at) VALUES (?,?)',[version,new Date().toISOString()]);
      });
      await connection.query('COMMIT');
    }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
  })().catch(error=>{initialized=undefined;throw error;});
  return initialized;
}
export async function query(sql:string,params:unknown[]=[]):Promise<Row[]> { await initDatabase();return (await raw(sql,params)).rows; }
export async function execute(sql:string,params:unknown[]=[]):Promise<{changes:number}> {await initDatabase();const result=await raw(sql,params);return {changes:result.changes};}
export async function transaction<T>(work:()=>Promise<T>):Promise<T> {
  await initDatabase();
  if(scope.getStore()) return work();
  if(pool) {
    const connection=await pool.connect();
    try {await connection.query('BEGIN');const result=await scope.run(connection,work);await connection.query('COMMIT');return result;}
    catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
  }
  return exclusive(async()=>{
    sqlite!.exec('BEGIN IMMEDIATE');
    try{const result=await scope.run('sqlite',work);sqlite!.exec('COMMIT');return result;}catch(error){sqlite!.exec('ROLLBACK');throw error;}
  });
}
export async function closeDatabase():Promise<void>{if(pool)await pool.end();sqlite?.close();pool=undefined;sqlite=undefined;initialized=undefined;}
