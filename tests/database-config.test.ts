import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDatabaseConfig } from '../src/lib/database-config';

const primary = 'postgresql://fixture:fixture@database.invalid/primary';
const netlify = 'postgresql://fixture:fixture@database.invalid/netlify';

test('local development preserves SQLite defaults and explicit in-memory databases', () => {
  const cwd=path.resolve('fixture-workspace');
  assert.deepEqual(resolveDatabaseConfig({},cwd),{kind:'sqlite',filename:path.join(cwd,'.data','italia-ora.sqlite')});
  assert.deepEqual(resolveDatabaseConfig({DATABASE_PATH:':memory:'}),{kind:'sqlite',filename:':memory:'});
});

test('an explicit DATABASE_URL takes precedence over the Netlify-provided URL', () => {
  const config=resolveDatabaseConfig({DATABASE_URL:primary,NETLIFY_DB_URL:netlify});
  assert.equal(config.kind,'postgres');
  if(config.kind==='postgres'){
    assert.equal(config.pool.connectionString,primary);
    assert.equal(config.pool.max,5);
    assert.equal(config.pool.allowExitOnIdle,false);
  }
});

test('NETLIFY_DB_URL also works outside Netlify for separate workers', () => {
  const config=resolveDatabaseConfig({DATABASE_URL:'  ',NETLIFY_DB_URL:` ${netlify} `});
  assert.equal(config.kind,'postgres');
  if(config.kind==='postgres')assert.equal(config.pool.connectionString,netlify);
});

test('cloud Netlify instances keep a small bounded pool without holding an idle event loop', () => {
  const config=resolveDatabaseConfig({NETLIFY:'true',NETLIFY_DB_URL:netlify});
  assert.equal(config.kind,'postgres');
  if(config.kind==='postgres'){
    assert.equal(config.pool.max,2);
    assert.equal(config.pool.allowExitOnIdle,true);
    assert.equal(config.pool.idleTimeoutMillis,10_000);
    assert.equal(config.pool.connectionTimeoutMillis,10_000);
    assert.equal(config.pool.statement_timeout,15_000);
  }
});

test('cloud Netlify fails closed without PostgreSQL even when a SQLite path is configured', () => {
  for(const env of [{NETLIFY:'true'},{NETLIFY:'true',DATABASE_PATH:'/tmp/articles.sqlite'},{NETLIFY:'true',DATABASE_URL:' ',NETLIFY_DB_URL:''}]){
    assert.throws(()=>resolveDatabaseConfig(env),/PostgreSQL persistente.*DATABASE_URL.*NETLIFY_DB_URL/);
  }
});

test('Netlify Dev explicitly retains local SQLite and normal local PostgreSQL pooling', () => {
  assert.deepEqual(resolveDatabaseConfig({NETLIFY:'true',NETLIFY_DEV:'true',DATABASE_PATH:':memory:'}),{kind:'sqlite',filename:':memory:'});
  const config=resolveDatabaseConfig({NETLIFY:'true',NETLIFY_DEV:'true',DATABASE_URL:primary});
  if(config.kind!=='postgres')assert.fail('Expected PostgreSQL');
  assert.equal(config.pool.max,5);
  assert.equal(config.pool.allowExitOnIdle,false);
});
