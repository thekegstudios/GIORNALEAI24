import { createHash, randomUUID } from 'node:crypto';
import { execute, query, transaction } from './db';
import { logAction } from './audit';
import type { FeedItem } from './feeds';
import type { Source } from './types';
import type { JobState, NewsroomJob, VerificationReport } from './newsroom-types';

export const JOB_LEASE_MS=180_000;
export const MAX_JOB_ATTEMPTS=3;
export interface StoredJob {id:string;idempotencyKey:string;source:Source;item:FeedItem;state:JobState;attempts:number;eventId:string|null;draft:import('./types').Article|null;verification:VerificationReport|null;createdAt:string;leaseOwner:string|null;leaseExpiresAt:string|null;lastError:string|null;availableAt:string;updatedAt:string}
function decode(row:Record<string,unknown>):StoredJob{return {id:String(row.id),idempotencyKey:String(row.idempotency_key),source:JSON.parse(String(row.source_payload)),item:JSON.parse(String(row.item_payload)),state:row.state as JobState,attempts:Number(row.attempts),eventId:row.event_id==null?null:String(row.event_id),draft:row.draft_payload?JSON.parse(String(row.draft_payload)):null,verification:row.verification_payload?JSON.parse(String(row.verification_payload)):null,createdAt:String(row.created_at),leaseOwner:row.lease_owner==null?null:String(row.lease_owner),leaseExpiresAt:row.lease_expires_at==null?null:String(row.lease_expires_at),lastError:row.last_error==null?null:String(row.last_error),availableAt:String(row.available_at),updatedAt:String(row.updated_at)};}
export function jobKey(sourceId:string,url:string,hash:string,purpose='ingestion'):string{return createHash('sha256').update(JSON.stringify([sourceId,url,hash,purpose])).digest('hex');}
export async function enqueueItem(source:Source,item:FeedItem,options:{reprocess?:boolean;model?:string;runId?:string}={}):Promise<{id:string;created:boolean}>{return transaction(async()=>{
  const key=jobKey(source.id,item.url,item.hash,options.reprocess?`reprocess:${options.model||'default'}`:'ingestion');
  const now=new Date().toISOString(),id=randomUUID();
  const known=await query('SELECT id FROM newsroom_jobs WHERE idempotency_key=?',[key]);if(known[0])return {id:String(known[0].id),created:false};
  const imported=await query('SELECT id,content_hash,imported_at FROM ingested_items WHERE source_id=? AND canonical_url=?',[source.id,item.url]);
  let legacy:Record<string,unknown>|undefined;
  if(!options.reprocess&&imported[0]?.content_hash===item.hash){
    const links=await query('SELECT e.id,e.status,e.updated_at,e.payload FROM events e JOIN citations c ON c.event_id=e.id WHERE c.item_id=? LIMIT 1',[imported[0].id]);legacy=links[0];
  }
  if(legacy){
    const reviews=await query('SELECT id FROM editorial_reviews WHERE event_id=? AND status=? LIMIT 1',[legacy.id,'pending']);
    const state:JobState=reviews.length?'REVIEW_REQUIRED':legacy.status==='published'?'PUBLISHED':legacy.status==='withdrawn'?'RETRACTED':legacy.status==='rejected'?'REJECTED':'REVIEW_REQUIRED';
    const created=String(imported[0].imported_at),updated=String(legacy.updated_at);
    const inserted=await query('INSERT INTO newsroom_jobs (id,idempotency_key,source_id,canonical_url,content_hash,item_payload,source_payload,state,attempts,available_at,event_id,draft_payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id',[id,key,source.id,item.url,item.hash,JSON.stringify(item),JSON.stringify(source),state,0,now,legacy.id,legacy.payload,created,updated]);
    if(inserted.length)await logAction('researcher','legacy-trace-imported',id,{eventId:legacy.id,state,sourceId:source.id,discoveredAt:created,note:'Scheda già elaborata prima della coda persistente; i passaggi precedenti non sono stati tracciati e non vengono ricostruiti.'},options.runId);
    if(inserted.length)return {id,created:false};
    const raced=await query('SELECT id FROM newsroom_jobs WHERE idempotency_key=?',[key]);return {id:String(raced[0].id),created:false};
  }
  await execute('INSERT INTO ingested_items (id,source_id,canonical_url,content_hash,payload,imported_at) VALUES (?,?,?,?,?,?) ON CONFLICT(source_id,canonical_url) DO UPDATE SET content_hash=excluded.content_hash,payload=excluded.payload',[imported[0]?.id||randomUUID(),source.id,item.url,item.hash,JSON.stringify(item),now]);
  const inserted=await query('INSERT INTO newsroom_jobs (id,idempotency_key,source_id,canonical_url,content_hash,item_payload,source_payload,state,attempts,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id',[id,key,source.id,item.url,item.hash,JSON.stringify(item),JSON.stringify(source),'DISCOVERED',0,now,now,now]);
  if(inserted.length){
    await logAction('researcher','item-discovered',id,{sourceId:source.id,url:item.url,inputHash:item.hash,sourcePublishedAt:item.publishedAt,discoveredAt:now,reprocess:Boolean(options.reprocess)},options.runId);
    return {id,created:true};
  }
  const existing=await query('SELECT id FROM newsroom_jobs WHERE idempotency_key=?',[key]);return {id:String(existing[0].id),created:false};
});}
export async function claimNextJob(owner:string):Promise<StoredJob|null>{return transaction(async()=>{
  const now=new Date().toISOString(),expires=new Date(Date.now()+JOB_LEASE_MS).toISOString();
  const states=['DISCOVERED','NORMALIZED','VERIFYING','DRAFT','APPROVED','FAILED'];
  const values=states.map(()=>'?').join(',');
  const rows=await query(`UPDATE newsroom_jobs SET lease_owner=?,lease_expires_at=?,attempts=attempts+1,state=CASE WHEN state='FAILED' THEN 'DISCOVERED' ELSE state END,updated_at=? WHERE id=(SELECT id FROM newsroom_jobs WHERE state IN (${values}) AND available_at<=? AND attempts<? AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY created_at,id LIMIT 1) AND (lease_expires_at IS NULL OR lease_expires_at<=?) RETURNING *`,[owner,expires,now,...states,now,MAX_JOB_ATTEMPTS,now,now]);
  if(!rows[0])return null;
  const job=decode(rows[0]);
  await logAction('supervisor','job-claimed',job.id,{state:job.state,attempt:job.attempts,leaseOwner:owner,leaseExpiresAt:expires},owner);
  return job;
});}
export async function renewJobLease(id:string,owner:string):Promise<void>{
  const now=new Date().toISOString();const rows=await query('UPDATE newsroom_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_owner=? AND lease_expires_at>? RETURNING id',[new Date(Date.now()+JOB_LEASE_MS).toISOString(),now,id,owner,now]);if(!rows.length)throw new Error('Lease del job scaduta o assegnata a un altro processo');
}
const transitions:Partial<Record<JobState,JobState[]>>={DISCOVERED:['NORMALIZED','FAILED','REJECTED'],NORMALIZED:['VERIFYING','FAILED','REJECTED'],VERIFYING:['DRAFT','FAILED','REJECTED'],DRAFT:['REVIEW_REQUIRED','APPROVED','FAILED'],APPROVED:['PUBLISHED','UPDATED','REVIEW_REQUIRED','FAILED'],FAILED:['DISCOVERED']};
export async function transitionJob(id:string,owner:string,state:JobState,patch:{eventId?:string|null;draft?:import('./types').Article|null;verification?:VerificationReport|null;runId?:string}={}):Promise<void>{return transaction(async()=>{
  await renewJobLease(id,owner);
  const rows=await query('SELECT * FROM newsroom_jobs WHERE id=?',[id]);const job=decode(rows[0]);
  if(job.state!==state&&!transitions[job.state]?.includes(state))throw new Error(`Passaggio di coda non valido: ${job.state} → ${state}`);
  const terminal=['PUBLISHED','UPDATED','REVIEW_REQUIRED','REJECTED','RETRACTED'].includes(state);
  const eventId=patch.eventId===undefined?job.eventId:patch.eventId;
  const verification=patch.verification===undefined?job.verification:patch.verification;
  const draft=patch.draft===undefined?job.draft:patch.draft;
  await execute('UPDATE newsroom_jobs SET state=?,event_id=?,draft_payload=?,verification_payload=?,last_error=NULL,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=?',[state,eventId,draft?JSON.stringify(draft):null,verification?JSON.stringify(verification):null,terminal?null:owner,terminal?null:new Date(Date.now()+JOB_LEASE_MS).toISOString(),new Date().toISOString(),id]);
  if(verification)await execute('INSERT INTO newsroom_verifications (job_id,event_id,payload,checked_at) VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET event_id=excluded.event_id,payload=excluded.payload,checked_at=excluded.checked_at',[id,eventId,JSON.stringify(verification),verification.checkedAt]);
  const module=state==='NORMALIZED'?'researcher':state==='VERIFYING'?'verifier':state==='DRAFT'?'writer':state==='UPDATED'?'updater':'supervisor';
  await logAction(module,'job-state-changed',id,{from:job.state,to:state,eventId},patch.runId);
});}
export async function failJob(id:string,owner:string,error:unknown,runId?:string):Promise<void>{return transaction(async()=>{
  const rows=await query('SELECT * FROM newsroom_jobs WHERE id=? AND lease_owner=?',[id,owner]);if(!rows[0])return;
  const job=decode(rows[0]);const message=(error instanceof Error?error.message:String(error)).slice(0,1000);
  const exhausted=job.attempts>=MAX_JOB_ATTEMPTS;
  const availableAt=new Date(Date.now()+Math.min(900_000,30_000*2**Math.max(0,job.attempts-1))).toISOString();
  await execute('UPDATE newsroom_jobs SET state=?,last_error=?,available_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?',['FAILED',message,availableAt,new Date().toISOString(),id,owner]);
  await logAction('supervisor',exhausted?'job-attempts-exhausted':'job-retry-scheduled',id,{error:message,attempts:job.attempts,availableAt,exhausted},runId);
});}
export async function recoverExpiredJobs(runId?:string):Promise<number>{return transaction(async()=>{
  const now=new Date().toISOString();
  const jobs=await query('UPDATE newsroom_jobs SET state=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL,available_at=?,updated_at=? WHERE lease_owner IS NOT NULL AND lease_expires_at<=? AND state IN (?,?,?,?,?) RETURNING id,attempts',['FAILED','Lease scaduta: elaborazione recuperabile',now,now,now,'DISCOVERED','NORMALIZED','VERIFYING','DRAFT','APPROVED']);
  for(const job of jobs)await logAction('supervisor','expired-job-recovered',String(job.id),{attempts:Number(job.attempts),exhausted:Number(job.attempts)>=MAX_JOB_ATTEMPTS},runId);
  return jobs.length;
});}
export async function retryJob(id:string):Promise<void>{return transaction(async()=>{
  const now=new Date().toISOString();const rows=await query('UPDATE newsroom_jobs SET state=?,attempts=0,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND state=? AND lease_owner IS NULL RETURNING id',['DISCOVERED',now,now,id,'FAILED']);
  if(!rows.length)throw new Error('È possibile riprovare soltanto un job fallito e non in esecuzione');
  await logAction('supervisor','job-retry-authorized',id,{attemptsReset:true});
});}
export async function listJobs(limit=50):Promise<NewsroomJob[]>{return (await query('SELECT * FROM newsroom_jobs ORDER BY created_at DESC,id DESC LIMIT ?',[Math.max(1,Math.min(500,Math.trunc(limit)||50))])).map(row=>{const job=decode(row);return {id:job.id,state:job.state,title:job.item.title,sourceId:job.source.id,sourceName:job.source.name,canonicalUrl:job.item.url,eventId:job.eventId,attempts:job.attempts,lastError:job.lastError,discoveredAt:job.createdAt,sourcePublishedAt:job.item.publishedAt,updatedAt:job.updatedAt,availableAt:job.availableAt,verification:job.verification};});}
export async function getQueueCounts():Promise<Partial<Record<JobState,number>>>{return Object.fromEntries((await query('SELECT state,COUNT(*) AS total FROM newsroom_jobs GROUP BY state')).map(row=>[String(row.state),Number(row.total)]));}
