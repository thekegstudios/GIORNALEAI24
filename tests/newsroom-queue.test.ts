import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { closeDatabase, execute, initDatabase, query } from '../src/lib/db';
import { parseFeed } from '../src/lib/feeds';
import { runIngestion } from '../src/lib/pipeline';
import { claimNextJob, enqueueItem, failJob, getQueueCounts, listJobs, recoverExpiredJobs, renewJobLease, retryJob, transitionJob } from '../src/lib/queue';
import { getNews, getSettings } from '../src/lib/store';
import type { Article, Settings, Source } from '../src/lib/types';

const source:Source={id:'ispra',name:'ISPRA fixture',homepage:'https://www.isprambiente.gov.it',feedUrl:'https://www.isprambiente.gov.it/it/fixture/rss',authorized:true,enabled:true,license:'CC BY 4.0',termsUrl:'https://www.isprambiente.gov.it/it/note-legali',allowSummary:true,official:true,region:null,lastCheckedAt:null,lastSuccessAt:null,lastError:null};
const envKeys=['DATABASE_PATH','DATABASE_URL','OPENAI_API_KEY','OPENAI_MODEL','AI_INPUT_USD_PER_MILLION','AI_OUTPUT_USD_PER_MILLION'] as const;
async function isolated(work:()=>Promise<void>){
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]])),fetch=globalThis.fetch;
  const directory=await mkdtemp(path.join(os.tmpdir(),'giornale-queue-fixture-'));
  await closeDatabase();
  process.env.DATABASE_PATH=path.join(directory,'isolated.sqlite');delete process.env.DATABASE_URL;delete process.env.OPENAI_API_KEY;
  globalThis.fetch=async()=>{throw new Error('Network is forbidden: every request must use a fixture');};
  try{
    await initDatabase();await execute('DELETE FROM sources');
    await execute('INSERT INTO sources (id,payload) VALUES (?,?)',[source.id,JSON.stringify(source)]);
    await configure({paused:false,safetyMode:false,autoPublish:true,maxItemsPerRun:5});
    await work();
  }finally{
    globalThis.fetch=fetch;await closeDatabase();
    for(const key of envKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    await rm(directory,{recursive:true,force:true});
  }
}
async function configure(changes:Partial<Settings>){await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify({...await getSettings(),...changes}),'global']);}
function xml(count=1,suffix='initial'){
  const date=new Date().toUTCString();
  return `<rss><channel>${Array.from({length:count},(_,index)=>`<item><title>TEST FIXTURE Inventario ambientale ${suffix} ${index}</title><link>https://www.isprambiente.gov.it/it/fixture-${index}</link><pubDate>${date}</pubDate><description>TEST FIXTURE: dati ambientali pubblici per la prova ${suffix} ${index}.</description></item>`).join('')}</channel></rss>`;
}
function enableAI(){process.env.OPENAI_API_KEY='fixture-only-never-sent';process.env.OPENAI_MODEL='fixture-model';process.env.AI_INPUT_USD_PER_MILLION='0.1';process.env.AI_OUTPUT_USD_PER_MILLION='0.2';}
function aiResponse(feed:string){
  const claim={text:'TEST FIXTURE: sintesi ambientale attribuita alla fonte.',evidenceIds:[parseFeed(feed,source)[0].hash]};
  const result={summary:claim,context:claim,confirmed:[claim],unconfirmed:[],categories:['ambiente'],relevance:50,sensitive:false,contradictions:false,explanations:{simple:claim,detailed:claim,causes:claim,consequences:claim,practical:claim}};
  return new Response(JSON.stringify({status:'completed',usage:{input_tokens:120,output_tokens:80},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}));
}
async function pendingAI(feed:string){
  enableAI();await configure({aiModel:'fixture-model',dailyBudgetUsd:1,monthlyBudgetUsd:10});
  let started!:()=>void,release!:(value:Response)=>void,calls=0;
  const entered=new Promise<void>(resolve=>{started=resolve;}),pending=new Promise<Response>(resolve=>{release=resolve;});
  globalThis.fetch=async(input)=>{if(String(input)==='https://api.openai.com/v1/responses'){calls++;started();return pending;}assert.equal(String(input),source.feedUrl);return new Response(feed);};
  const run=runIngestion({force:true});
  await Promise.race([entered,run.then(result=>{throw new Error(`AI fixture was not called: ${JSON.stringify(result)}`);})]);
  return {run,release:()=>release(aiResponse(feed)),calls:()=>calls};
}

test('discovery stores the whole feed while each run processes only its configured allowance',()=>isolated(async()=>{
  const feed=xml(12);globalThis.fetch=async()=>new Response(feed);await configure({maxItemsPerRun:2});
  const first=await runIngestion({force:true});assert.equal(first.status,'completed');assert.equal(first.imported,2);
  assert.deepEqual(await getQueueCounts(),{DISCOVERED:10,PUBLISHED:2});
  assert.equal((await query('SELECT id FROM ingested_items')).length,12);
  const second=await runIngestion({force:true});assert.equal(second.imported,2);assert.equal(second.duplicates,12);
  assert.deepEqual(await getQueueCounts(),{DISCOVERED:8,PUBLISHED:4});
  for(let index=0;index<4;index++)await runIngestion({force:true});
  assert.equal((await getNews()).length,12);assert.deepEqual(await getQueueCounts(),{PUBLISHED:12});
  assert.equal((await query('SELECT id FROM article_versions')).length,0,'unchanged discoveries never manufacture article revisions');
}));

test('idempotent concurrent discoveries keep immutable input snapshots for every changed version',()=>isolated(async()=>{
  const first=parseFeed(xml(),source)[0];
  const inserted=await Promise.all([enqueueItem(source,first),enqueueItem(source,first)]);
  assert.equal(inserted.filter(result=>result.created).length,1);assert.equal(inserted[0].id,inserted[1].id);
  const second=parseFeed(xml(1,'changed'),source)[0];await enqueueItem(source,second);
  const jobs=await query('SELECT item_payload FROM newsroom_jobs');assert.equal(jobs.length,2);
  assert.deepEqual(new Set(jobs.map(row=>JSON.parse(String(row.item_payload)).hash)),new Set([first.hash,second.hash]));
  assert.equal((await query('SELECT content_hash FROM ingested_items'))[0].content_hash,second.hash);
}));

test('AI uses the article evidence snapshot rather than a newer discovery still waiting in the cursor',()=>isolated(async()=>{
  const original=xml(),originalItem=parseFeed(original,source)[0];globalThis.fetch=async()=>new Response(original);await runIngestion({force:true});
  const unpublishedDiscovery=parseFeed(xml(1,'unprocessed-change'),source)[0];
  await execute('UPDATE ingested_items SET content_hash=?,payload=? WHERE source_id=?',[unpublishedDiscovery.hash,JSON.stringify(unpublishedDiscovery),source.id]);
  await execute('UPDATE sources SET payload=? WHERE id=?',[JSON.stringify({...source,enabled:false}),source.id]);
  const otherSource={...source,id:'fixture-second-source',name:'Second fixture source',feedUrl:'https://www.isprambiente.gov.it/it/fixture/second-rss'};
  await execute('INSERT INTO sources (id,payload) VALUES (?,?)',[otherSource.id,JSON.stringify(otherSource)]);
  enableAI();await configure({aiModel:'fixture-model'});
  const corroborating=original.replaceAll('dati ambientali pubblici','seconda attribuzione dei dati ambientali'),otherItem=parseFeed(corroborating,otherSource)[0];
  let evidenceHashes:string[]=[];
  globalThis.fetch=async(input,options)=>{
    if(String(input)==='https://api.openai.com/v1/responses'){
      const body=JSON.parse(String(options!.body));evidenceHashes=JSON.parse(body.input[0].content[0].text).map((entry:{id:string})=>entry.id);
      return aiResponse(corroborating);
    }
    assert.equal(String(input),otherSource.feedUrl);return new Response(corroborating);
  };
  const result=await runIngestion({force:true});assert.equal(result.review,1);
  assert.deepEqual(new Set(evidenceHashes),new Set([originalItem.hash,otherItem.hash]));
  assert.ok(!evidenceHashes.includes(unpublishedDiscovery.hash));
}));

test('job leases recover saved work, reject stale owners, back off and require explicit retry after exhaustion',()=>isolated(async()=>{
  const item=parseFeed(xml(),source)[0],queued=await enqueueItem(source,item);
  const claims=await Promise.all([claimNextJob('first-worker'),claimNextJob('competing-worker')]);
  assert.equal(claims.filter(Boolean).length,1);const claimed=claims.find(Boolean)!;const owner=claimed.leaseOwner!;
  await assert.rejects(transitionJob(queued.id,owner,'PUBLISHED'),/non valido/);
  await transitionJob(queued.id,owner,'NORMALIZED');await transitionJob(queued.id,owner,'VERIFYING');
  const savedDraft:Article={id:'fixture-event',slug:'fixture-event',title:item.title,summary:'TEST FIXTURE saved draft',context:'TEST FIXTURE',categories:['ambiente'],region:null,province:null,municipality:null,locationEvidence:null,relevance:50,status:'review',publishedAt:item.publishedAt!,updatedAt:new Date().toISOString(),confirmed:[],unconfirmed:[],explanations:{simple:'TEST FIXTURE',detailed:'TEST FIXTURE',causes:'Non disponibili',consequences:'Non disponibili',practical:'Non disponibile'},citations:[],timeline:[],reviewReasons:[],aiGenerated:true,originalContent:true};
  await transitionJob(queued.id,owner,'DRAFT',{eventId:savedDraft.id,draft:savedDraft});
  await execute('UPDATE newsroom_jobs SET lease_expires_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',queued.id]);
  assert.equal(await recoverExpiredJobs('recovery-run'),1);assert.equal(await recoverExpiredJobs('recovery-run'),0);
  await assert.rejects(transitionJob(queued.id,owner,'APPROVED'),/Lease/);
  const recovered=await claimNextJob('replacement-worker');assert.equal(recovered!.attempts,2);assert.deepEqual(recovered!.draft,savedDraft);
  await assert.rejects(renewJobLease(queued.id,owner),/Lease/);
  await failJob(queued.id,'replacement-worker',new Error('FIXTURE temporary failure'));
  assert.equal(await claimNextJob('too-early'),null,'retry backoff prevents a tight failure loop');
  const failed=(await listJobs())[0];assert.equal(failed.state,'FAILED');assert.match(failed.lastError!,/temporary failure/);assert.ok(Date.parse(failed.availableAt)>Date.now());
  await execute('UPDATE newsroom_jobs SET available_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',queued.id]);
  assert.equal((await claimNextJob('last-attempt'))!.attempts,3);await failJob(queued.id,'last-attempt',new Error('FIXTURE final failure'));
  await execute('UPDATE newsroom_jobs SET available_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',queued.id]);
  assert.equal(await claimNextJob('exhausted'),null);await retryJob(queued.id);
  const retry=await claimNextJob('authorized-retry');assert.equal(retry!.attempts,1);assert.deepEqual(retry!.draft,savedDraft);
  const actions=(await query('SELECT action FROM newsroom_actions')).map(row=>row.action);
  for(const action of ['expired-job-recovered','job-attempts-exhausted','job-retry-authorized','job-claimed'])assert.ok(actions.includes(action));
}));

test('an interrupted publication rolls back article, citations and terminal state while retaining its checkpoint',()=>isolated(async()=>{
  const feed=xml();globalThis.fetch=async()=>new Response(feed);
  await execute("CREATE TRIGGER fixture_interrupt BEFORE INSERT ON citations BEGIN SELECT RAISE(ABORT, 'FIXTURE interrupted commit'); END");
  const interrupted=await runIngestion({force:true});assert.equal(interrupted.status,'partial');assert.equal(interrupted.imported,0);
  for(const table of ['events','citations','editorial_reviews'])assert.equal((await query(`SELECT * FROM ${table}`)).length,0,table);
  const checkpoint=(await query('SELECT id,state,draft_payload FROM newsroom_jobs'))[0];assert.equal(checkpoint.state,'FAILED');assert.ok(checkpoint.draft_payload);
  assert.equal((await query('SELECT action FROM newsroom_actions WHERE action=?',['article-published'])).length,0);
  await execute('DROP TRIGGER fixture_interrupt');await retryJob(String(checkpoint.id));
  const resumed=await runIngestion({force:true});assert.equal(resumed.published,1);assert.equal((await getNews()).length,1);
  assert.deepEqual(await getQueueCounts(),{PUBLISHED:1});
}));

test('existing articles gain an honest legacy trace without fabricated verification or transitions',()=>isolated(async()=>{
  const feed=xml();globalThis.fetch=async()=>new Response(feed);await runIngestion({force:true});
  const imported=(await query('SELECT imported_at FROM ingested_items'))[0],article=(await getNews())[0];
  await execute('DELETE FROM newsroom_verifications');await execute('DELETE FROM newsroom_jobs');await execute('DELETE FROM newsroom_actions');
  const legacy=await enqueueItem(source,parseFeed(feed,source)[0]);assert.equal(legacy.created,false);
  const job=(await listJobs())[0];assert.equal(job.state,'PUBLISHED');assert.equal(job.eventId,article.id);assert.equal(job.discoveredAt,imported.imported_at);assert.equal(job.verification,null);
  const actions=await query('SELECT action,details FROM newsroom_actions');assert.equal(actions.length,1);assert.equal(actions[0].action,'legacy-trace-imported');assert.match(String(actions[0].details),/non vengono ricostruiti/);
}));

test('three source failures open a temporary circuit without disabling the source and success restores it',()=>isolated(async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('FIXTURE denied',{status:403});};
  for(let attempt=0;attempt<3;attempt++)assert.equal((await runIngestion({force:true})).status,'partial');
  assert.equal(calls,3);const health=(await query('SELECT * FROM source_health'))[0];assert.equal(health.failures,3);assert.ok(Date.parse(String(health.suspended_until))>Date.now());
  await runIngestion({force:true});assert.equal(calls,3);assert.equal(JSON.parse(String((await query('SELECT payload FROM sources'))[0].payload)).enabled,true);
  await execute('UPDATE source_health SET suspended_until=?',['2000-01-01T00:00:00.000Z']);
  globalThis.fetch=async()=>{calls++;return new Response('<rss><channel/></rss>');};
  assert.equal((await runIngestion({force:true})).status,'completed');assert.equal(calls,4);
  assert.equal((await query('SELECT failures FROM source_health'))[0].failures,0);
  assert.equal((await query('SELECT id FROM newsroom_actions WHERE action=?',['source-circuit-recovered'])).length,1);
}));

test('safety mode enabled during an AI response is honored at commit and citations alone never confirm claims',()=>isolated(async()=>{
  const feed=xml(),provider=await pendingAI(feed);await configure({safetyMode:true});provider.release();
  const result=await provider.run;assert.equal(result.published,0);assert.equal(result.review,1);assert.equal(provider.calls(),1);
  const article=JSON.parse(String((await query('SELECT payload FROM events'))[0].payload)) as Article;
  assert.equal(article.aiGenerated,true);assert.equal(article.verification!.status,'NEEDS_VERIFICATION');
  assert.ok(article.reviewReasons.some(reason=>reason.includes('Modalità sicurezza')));assert.ok(article.reviewReasons.some(reason=>reason.includes('verifica semantica')));
  assert.ok(article.verification!.claims.every(claim=>claim.status==='NEEDS_VERIFICATION'));assert.equal(article.seo!.indexable,false);
  assert.equal((await getNews()).length,0);await runIngestion({force:true});assert.equal(provider.calls(),1);
}));

test('a pause during AI preserves the paid draft and provenance and a later retry does not call the provider again',()=>isolated(async()=>{
  const feed=xml(),provider=await pendingAI(feed);await configure({paused:true});provider.release();
  const interrupted=await provider.run;assert.equal(interrupted.published,0);assert.ok(interrupted.errors.some(error=>error.includes('sospesa')));
  assert.equal((await query('SELECT id FROM events')).length,0);assert.equal((await query('SELECT id FROM generated_summaries')).length,1);
  const saved=(await query('SELECT id,state,draft_payload FROM newsroom_jobs'))[0];assert.equal(saved.state,'FAILED');assert.equal(JSON.parse(String(saved.draft_payload)).aiGenerated,true);
  assert.equal((await runIngestion({force:true})).status,'skipped','force cannot override an explicit pause');
  await configure({paused:false});await retryJob(String(saved.id));
  const resumed=await runIngestion({force:true});assert.equal(resumed.review,1);assert.equal(provider.calls(),1);assert.equal((await query('SELECT id FROM generated_summaries')).length,1);
  assert.equal((await query('SELECT id FROM ai_usage')).length,1);assert.deepEqual(await getQueueCounts(),{REVIEW_REQUIRED:1});
}));

test('source revocation during an AI response aborts publication and retains the draft for inspection',()=>isolated(async()=>{
  const provider=await pendingAI(xml());await execute('UPDATE sources SET payload=? WHERE id=?',[JSON.stringify({...source,authorized:false,enabled:false}),source.id]);provider.release();
  const result=await provider.run;assert.equal(result.published,0);assert.ok(result.errors.some(error=>error.includes('disabilitata')));
  assert.equal((await query('SELECT id FROM events')).length,0);const job=(await query('SELECT state,draft_payload FROM newsroom_jobs'))[0];assert.equal(job.state,'FAILED');assert.equal(JSON.parse(String(job.draft_payload)).aiGenerated,true);
}));

test('force cannot bypass safety mode or spend AI budget while it is active',()=>isolated(async()=>{
  enableAI();await configure({safetyMode:true,aiModel:'fixture-model'});
  let providerCalls=0;globalThis.fetch=async(input)=>{if(String(input).includes('api.openai.com')){providerCalls++;throw new Error('Safety mode must not call AI');}return new Response(xml());};
  const result=await runIngestion({force:true});assert.equal(result.published,0);assert.equal(result.review,1);assert.equal(providerCalls,0);assert.equal((await query('SELECT id FROM ai_usage')).length,0);
}));
