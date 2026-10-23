import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { closeDatabase, execute, initDatabase, query } from '../src/lib/db';
import { parseFeed } from '../src/lib/feeds';
import { sensitiveReasons, sourceDateReasons } from '../src/lib/editorial';
import { acquirePipelineLock, releasePipelineLock, reprocessMetadata, runIngestion } from '../src/lib/pipeline';
import { getAdminData, getArticle, getCorrections, getNews, getSettings, getSources, moderateArticle, setSourceEnabled, updateSettings } from '../src/lib/store';
import { generateSummary } from '../src/lib/ai';
import type { Source } from '../src/lib/types';

const folder=await mkdtemp(path.join(os.tmpdir(),'italia-ora-backend-'));
process.env.DATABASE_PATH=path.join(folder,'test.sqlite');
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;
const originalFetch=globalThis.fetch;
after(async()=>{globalThis.fetch=originalFetch;await closeDatabase();await rm(folder,{recursive:true,force:true});});
const source:Source={id:'ispra',name:'ISPRA',homepage:'https://www.isprambiente.gov.it',feedUrl:'https://www.isprambiente.gov.it/it/news/notizie/RSS',authorized:true,enabled:true,license:'CC BY 4.0',termsUrl:'https://www.isprambiente.gov.it/it/note-legali',allowSummary:true,official:true,region:null,lastCheckedAt:null,lastSuccessAt:null,lastError:null};
function feed(title='TEST FIXTURE Inventario degli ecosistemi italiani',sensitive=true){return `<?xml version="1.0"?><rss version="2.0"><channel><title>TEST FIXTURES ONLY</title><item><title>${title}</title><link>https://www.isprambiente.gov.it/it/test-fixture-ecosistemi</link><pubDate>${new Date().toUTCString()}</pubDate><description>TEST FIXTURE. Presentazione dei dati sugli ecosistemi.</description></item>${sensitive?'<item><title>TEST FIXTURE Cordoglio per la scomparsa di una persona</title><link>https://www.isprambiente.gov.it/it/test-fixture-cordoglio</link><description>TEST FIXTURE non pubblicare.</description></item>':''}</channel></rss>`;}

test('RSS, RDF and Atom preserve real attribution and reject foreign links or restricted rights',()=>{
  assert.equal(parseFeed(feed(),source).length,2);
  const rdf='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>TEST FIXTURE RDF</title><link>https://www.isprambiente.gov.it/it/fixture-rdf</link><description>Dato pubblico di prova.</description><dc:date>2026-10-20T10:00:00+02:00</dc:date><dc:rights></dc:rights></item></rdf:RDF>';
  assert.equal(parseFeed(rdf,source)[0].publishedAt,'2026-10-20T08:00:00.000Z');
  const atom='<feed><entry><title>TEST FIXTURE Atom</title><link rel="alternate" href="https://www.isprambiente.gov.it/it/fixture-atom"/><updated>2026-10-20T10:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(atom,source)[0].title,'TEST FIXTURE Atom');
  assert.equal(parseFeed(rdf.replace('<dc:rights></dc:rights>','<dc:rights>CC BY 4.0, solo uso non commerciale</dc:rights>'),source).length,0);
  assert.equal(parseFeed(feed().replaceAll('https://www.isprambiente.gov.it/it/test-','https://third-party.example/it/test-'),source).length,0);
  assert.throws(()=>parseFeed('<!DOCTYPE foo><rss/>',source),/non consentite/);
});

test('deterministic safety catches sensitive Italian titles, including obituaries',()=>{
  for(const title of ['Cordoglio per la scomparsa del ricercatore','Due minori coinvolti','Allerta arancione in Liguria','Un uomo indagato','Una persona è deceduta'])assert.ok(sensitiveReasons(title).length,title);
  assert.equal(sensitiveReasons('Inventario nazionale della biodiversità').length,0);
});

test('source dates gate missing, future and historical items before auto publication',()=>{
  const now=Date.now();
  assert.ok(sourceDateReasons(null,now).length);
  assert.ok(sourceDateReasons(new Date(now+6*60_000).toISOString(),now).length);
  assert.ok(sourceDateReasons(new Date(now-73*3600_000).toISOString(),now).length);
  assert.deepEqual(sourceDateReasons(new Date(now-3600_000).toISOString(),now),[]);
});

test('fresh database contains authorized sources and no fabricated articles',async()=>{
  await initDatabase();
  assert.equal((await getNews()).length,0);
  assert.ok((await getSources()).some(item=>item.id==='ispra'&&item.authorized));
  await assert.rejects(setSourceEnabled('ansa',true),/diritti documentati/);
});

test('pipeline lease is atomic, expires, and cannot be released by a stale owner',async()=>{
  const [first,second]=await Promise.all([acquirePipelineLock('owner-one'),acquirePipelineLock('owner-two')]);
  assert.equal(Number(first)+Number(second),1);
  await execute('UPDATE pipeline_locks SET expires_at=?',['2000-01-01T00:00:00.000Z']);
  assert.equal(await acquirePipelineLock('owner-three'),true);
  await releasePipelineLock('owner-one');
  assert.equal(await acquirePipelineLock('owner-four'),false);
  await releasePipelineLock('owner-three');
});

test('independent Node processes contend on the same database lease',async()=>{
  const script="import { acquirePipelineLock } from './src/lib/pipeline.ts'; import { closeDatabase } from './src/lib/db.ts'; const won=await acquirePipelineLock(process.argv[1]); console.log(won?'won':'lost'); await closeDatabase();";
  const child=(owner:string)=>new Promise<string>((resolve,reject)=>{
    const processHandle=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script,owner],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});let output='',errors='';processHandle.stdout.on('data',part=>output+=part);processHandle.stderr.on('data',part=>errors+=part);processHandle.on('error',reject);processHandle.on('close',code=>code===0?resolve(output.trim()):reject(new Error(errors)));
  });
  const results=await Promise.all([child('process-a'),child('process-b')]);
  assert.deepEqual(results.sort(),['lost','won']);
  await execute('DELETE FROM pipeline_locks');
});

test('ingestion isolates failures, deduplicates, preserves published revision, and logs corrections',async()=>{
  let current=feed();
  globalThis.fetch=async(input)=>String(input).includes('isprambiente')?new Response(current,{status:200}):new Response('Denied',{status:403});
  const initial=await runIngestion({force:true});
  assert.equal(initial.status,'partial');assert.equal(initial.imported,2);assert.equal(initial.published,1);assert.equal(initial.review,1);
  let articles=await getNews();assert.equal(articles.length,1);assert.equal(articles[0].aiGenerated,false);assert.equal(articles[0].region,null);
  const initialArticle=articles[0];
  const repeated=await runIngestion({force:true});assert.equal(repeated.imported,0);assert.equal(repeated.published,0);assert.equal(repeated.duplicates,2);
  assert.equal((await query('SELECT id FROM article_versions')).length,0);
  current=feed('TEST FIXTURE Cordoglio e scomparsa: aggiornamento sensibile');
  const changed=await runIngestion({force:true});assert.equal(changed.imported,1);assert.equal(changed.review,1);
  assert.equal((await getArticle(initialArticle.slug))?.title,initialArticle.title);
  const candidate=(await getAdminData()).articles.find(article=>article.id===initialArticle.id)!;
  assert.equal(candidate.status,'review');assert.match(candidate.title,/Cordoglio/);
  await moderateArticle(initialArticle.id,'approve',{title:'TEST FIXTURE Cordoglio: titolo rivisto',summary:'TEST FIXTURE Sintesi rivista dalla redazione',reason:'Approvazione e correzione della fixture'});
  assert.match((await getArticle(initialArticle.slug))!.title,/Cordoglio/);
  assert.equal((await getArticle(initialArticle.slug))!.summary,'TEST FIXTURE Sintesi rivista dalla redazione');
  await assert.rejects(moderateArticle(initialArticle.id,'correct',{title:'TEST FIXTURE Corretto'}),/motivazione/);
  await moderateArticle(initialArticle.id,'correct',{title:'TEST FIXTURE Corretto',reason:'Correzione di prova esplicitamente identificata'});
  assert.equal((await getCorrections()).length,2);
  await moderateArticle(initialArticle.id,'withdraw',{reason:'Ritiro della fixture di test'});
  assert.equal(await getArticle(initialArticle.slug),null);
  articles=await getNews({status:'review'});assert.equal(articles.length,0,'public accessor never leaks non-published content');
  globalThis.fetch=originalFetch;
});

test('AI fails closed without model-specific prices or available budget',async()=>{
  process.env.OPENAI_API_KEY='test-key-never-sent';process.env.AI_INPUT_USD_PER_MILLION='0.1';process.env.AI_OUTPUT_USD_PER_MILLION='0.2';process.env.OPENAI_MODEL='configured-model';
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network call');};
  const settings=await getSettings();
  assert.equal(await generateSummary(parseFeed(feed(),source),{...settings,aiModel:'different-model'},'test-run'),null);
  assert.equal(await generateSummary(parseFeed(feed(),source),{...settings,aiModel:'configured-model',dailyBudgetUsd:0},'test-run'),null);
  assert.equal(calls,0);
  delete process.env.OPENAI_API_KEY;delete process.env.AI_INPUT_USD_PER_MILLION;delete process.env.AI_OUTPUT_USD_PER_MILLION;delete process.env.OPENAI_MODEL;globalThis.fetch=originalFetch;
});

test('concurrent AI reservations enforce the daily budget and reject fabricated evidence IDs',async()=>{
  process.env.OPENAI_API_KEY='test-key-never-sent';process.env.AI_INPUT_USD_PER_MILLION='0.1';process.env.AI_OUTPUT_USD_PER_MILLION='0.2';process.env.OPENAI_MODEL='configured-model';
  const previousSettings=await getSettings();await updateSettings({aiModel:'configured-model'});
  const items=parseFeed(feed('TEST FIXTURE Inventario degli ecosistemi italiani',false),source);
  const claim={text:'TEST FIXTURE. Dati sugli ecosistemi.',evidenceIds:[items[0].hash]};
  const valid={summary:claim,context:claim,confirmed:[claim],unconfirmed:[],categories:['ambiente'],relevance:50,sensitive:false,contradictions:false,explanations:{simple:claim,detailed:claim,causes:claim,consequences:claim,practical:claim}};
  let releaseResponse!:(response:Response)=>void;
  const responsePending=new Promise<Response>(resolve=>{releaseResponse=resolve;});
  let calls=0;globalThis.fetch=async()=>{calls++;return responsePending;};
  const settings={...await getSettings(),aiModel:'configured-model',dailyBudgetUsd:0.0011};
  const first=generateSummary(items,settings,'budget-concurrent-test');
  const second=generateSummary(items,settings,'budget-concurrent-test');
  assert.equal(await Promise.race([first,second]),null);
  assert.equal(calls,1);
  const response=(value:unknown)=>new Response(JSON.stringify({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200});
  releaseResponse(response(valid));
  const results=await Promise.all([first,second]);assert.equal(results.filter(Boolean).length,1);
  globalThis.fetch=async()=>response({...valid,summary:{text:'TEST FIXTURE Claim',evidenceIds:['invented-evidence']}});
  await assert.rejects(generateSummary(items,{...settings,dailyBudgetUsd:0.1},'invalid-evidence-test'),/fuori dalle prove/);
  const usage=await query('SELECT status,reserved_usd,actual_usd FROM ai_usage WHERE run_id=?',['invalid-evidence-test']);
  assert.equal(usage[0].status,'failed');assert.ok(Number(usage[0].actual_usd)>0);
  await updateSettings({aiModel:previousSettings.aiModel});
  delete process.env.OPENAI_API_KEY;delete process.env.AI_INPUT_USD_PER_MILLION;delete process.env.AI_OUTPUT_USD_PER_MILLION;delete process.env.OPENAI_MODEL;globalThis.fetch=originalFetch;
});

test('archive, future and sensitive feed items enter review without an AI charge',async()=>{
  process.env.OPENAI_API_KEY='test-key-never-sent';process.env.AI_INPUT_USD_PER_MILLION='0.1';process.env.AI_OUTPUT_USD_PER_MILLION='0.2';process.env.OPENAI_MODEL='gpt-4.1-mini';
  const now=Date.now();
  const xml=`<rss><channel>${[['archivio',new Date(now-80*3600_000).toUTCString(),'TEST FIXTURE Archivio ambientale'],['futuro',new Date(now+3600_000).toUTCString(),'TEST FIXTURE Ambiente futuro'],['sensibile',new Date(now).toUTCString(),'TEST FIXTURE Cordoglio per una scomparsa']].map(([id,date,title])=>`<item><title>${title}</title><link>https://www.isprambiente.gov.it/it/test-fixture-${id}</link><pubDate>${date}</pubDate><description>TEST FIXTURE non reale.</description></item>`).join('')}</channel></rss>`;
  let aiCalls=0;globalThis.fetch=async(input)=>{if(String(input).includes('openai')){aiCalls++;throw new Error('Unexpected AI call');}return String(input).includes('isprambiente')?new Response(xml):new Response('Denied',{status:403});};
  const result=await runIngestion({force:true});assert.equal(result.imported,3);assert.equal(result.review,3);assert.equal(result.published,0);assert.equal(aiCalls,0);
  delete process.env.OPENAI_API_KEY;delete process.env.AI_INPUT_USD_PER_MILLION;delete process.env.AI_OUTPUT_USD_PER_MILLION;delete process.env.OPENAI_MODEL;globalThis.fetch=originalFetch;
});

test('explicit AI reprocessing handles existing metadata once and preserves public copy until approval',async()=>{
  const xml=feed('TEST FIXTURE Nuovo inventario delle foreste',false).replaceAll('test-fixture-ecosistemi','test-fixture-foreste');
  let aiCalls=0;
  const parsed=parseFeed(xml,source);
  const claim={text:'TEST FIXTURE. Elaborazione delle foreste.',evidenceIds:[parsed[0].hash]};
  const valid={summary:claim,context:claim,confirmed:[claim],unconfirmed:[],categories:['ambiente'],relevance:50,sensitive:false,contradictions:false,explanations:{simple:claim,detailed:claim,causes:claim,consequences:claim,practical:claim}};
  globalThis.fetch=async(input)=>{
    if(String(input).includes('openai')){aiCalls++;return new Response(JSON.stringify({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(valid)}]}]}));}
    return String(input).includes('isprambiente')?new Response(xml):new Response('Denied',{status:403});
  };
  await runIngestion({force:true});
  const metadata=(await getNews()).find(article=>article.title.includes('foreste'))!;assert.ok(metadata);assert.equal(metadata.aiGenerated,false);
  process.env.OPENAI_API_KEY='test-key-never-sent';process.env.AI_INPUT_USD_PER_MILLION='0.1';process.env.AI_OUTPUT_USD_PER_MILLION='0.2';process.env.OPENAI_MODEL='gpt-4.1-mini';
  await runIngestion({force:true});assert.equal(aiCalls,0,'scheduled deduplication never repeats inference');
  const reprocessed=await reprocessMetadata();assert.equal(reprocessed.imported,1);assert.equal(reprocessed.review,1);assert.equal(aiCalls,1);
  assert.equal((await getArticle(metadata.slug))!.aiGenerated,false);
  assert.equal((await getAdminData()).articles.find(article=>article.id===metadata.id)!.aiGenerated,true);
  await reprocessMetadata();assert.equal(aiCalls,1,'existing pending summary is reused');
  delete process.env.OPENAI_API_KEY;delete process.env.AI_INPUT_USD_PER_MILLION;delete process.env.AI_OUTPUT_USD_PER_MILLION;delete process.env.OPENAI_MODEL;globalThis.fetch=originalFetch;
});
