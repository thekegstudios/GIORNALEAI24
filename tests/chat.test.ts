import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeDatabase, execute, initDatabase, query } from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/catalog';
import { answerQuestion, answerWithContext } from '../src/lib/chat';
import { completeClaims, responseEvents } from '../src/lib/chat-stream';
import type { ChatStreamEvent } from '../src/lib/newsroom-types';
import { getBudgetOverview } from '../src/lib/budget';
import { POST } from '../src/app/api/chat/route';
import type { Article, Settings } from '../src/lib/types';

process.env.DATABASE_PATH=':memory:';delete process.env.DATABASE_URL;
const originalFetch=globalThis.fetch;
const keys=['OPENAI_API_KEY','OPENAI_MODEL','AI_INPUT_USD_PER_MILLION','AI_OUTPUT_USD_PER_MILLION','SITE_URL'];
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
let settings:Settings;
beforeEach(async()=>{
  await closeDatabase();delete process.env.OPENAI_API_KEY;
  process.env.SITE_URL='http://localhost:3000';process.env.OPENAI_MODEL='chat-test-model';
  process.env.AI_INPUT_USD_PER_MILLION='0.1';process.env.AI_OUTPUT_USD_PER_MILLION='0.2';
  globalThis.fetch=async()=>{throw new Error('TEST: unexpected external request');};
  await initDatabase();
  settings={...DEFAULT_SETTINGS,paused:false,safetyMode:false,aiModel:'chat-test-model',dailyBudgetUsd:1,monthlyBudgetUsd:10,chatEnabled:false,chatDailyBudgetUsd:0};
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(settings),'global']);
});
after(async()=>{globalThis.fetch=originalFetch;await closeDatabase();for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
function article(id:string,partial:Partial<Article>={}):Article{
  const now=new Date().toISOString();
  return {id,slug:`test-fixture-${id}`,title:`TEST FIXTURE Inventario ambientale ${id}`,summary:'TEST FIXTURE. Dati pubblici sugli ecosistemi.',context:'TEST FIXTURE non reale.',categories:['ambiente'],region:null,province:null,municipality:null,locationEvidence:null,relevance:55,status:'published',publishedAt:now,updatedAt:now,confirmed:['TEST FIXTURE. Risultati pubblicati.'],unconfirmed:[],explanations:{simple:'TEST FIXTURE. Spiegazione già memorizzata.',detailed:'TEST FIXTURE. Approfondimento.',causes:'Non disponibili.',consequences:'Non disponibili.',practical:'Consulta il documento ufficiale.'},citations:[{sourceId:'ispra',sourceName:'ISPRA',url:`https://www.isprambiente.gov.it/it/test-fixture-${id}`,title:'TEST FIXTURE Fonte',publishedAt:now,checkedAt:now,license:'CC BY 4.0',termsUrl:'https://www.isprambiente.gov.it/it/note-legali'}],timeline:[{at:now,text:'TEST FIXTURE. Prima acquisizione.'}],reviewReasons:[],aiGenerated:false,originalContent:true,...partial};
}
async function save(value:Article){await execute('INSERT INTO events (id,slug,title,status,payload,published_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at',[value.id,value.slug,value.title,value.status,JSON.stringify(value),value.publishedAt,value.updatedAt]);}
async function enable(){process.env.OPENAI_API_KEY='TEST-KEY-NEVER-SENT';settings={...settings,chatEnabled:true,chatDailyBudgetUsd:0.1};await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(settings),'global']);}
function responseFor(request:RequestInit|undefined,invalid=false){
  const payload=JSON.parse(String(request?.body));
  const input=JSON.parse(payload.input[0].content[0].text);
  const text=`Sintesi della scheda ${input.articles[0].id}: dati pubblici sugli ecosistemi.`;
  return new Response(JSON.stringify({status:'completed',usage:{input_tokens:100,output_tokens:40},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({claims:[{text,sourceIds:[invalid?'invented-source':input.articles[0].evidence[0].id]}],uncertainties:[]})}]}]}));
}
test('archive answers use only published news and original source dates for today in Rome',async()=>{
  await save(article('today',{region:'Lombardia',locationEvidence:'TEST FIXTURE: territorio esplicito nella fonte.'}));
  const old=article('old');old.citations[0].publishedAt=new Date(Date.now()-2*86400_000).toISOString();await save(old);
  await save(article('draft',{status:'review',title:'TEST FIXTURE PRIVATE DRAFT'}));
  const result=await answerQuestion('Cosa è successo oggi in Italia?');
  assert.equal(result.mode,'archive');assert.ok(result.citations.some(item=>item.articleId==='today'));
  assert.ok(!result.citations.some(item=>item.articleId==='old'||item.articleId==='draft'));
  assert.ok(!result.answer.includes('PRIVATE DRAFT'));assert.equal((await getBudgetOverview()).callsToday,0);
  const local=await answerQuestion('Quali notizie della Lombardia?');assert.deepEqual(local.citations.map(item=>item.articleId),['today']);
});
test('uncertain provinces are not inferred from a regional article or a city mention',async()=>{
  await save(article('sicilia',{region:'Sicilia',locationEvidence:'TEST FIXTURE: solo regione documentata.',summary:'TEST FIXTURE. Il testo menziona Caltanissetta senza localizzare il fatto.'}));
  const result=await answerQuestion('Quali notizie nella provincia di Caltanissetta in Sicilia?');
  assert.equal(result.citations.length,0);assert.match(result.uncertainties.join(' '),/territorio.*non risulta documentato/i);
});

test('archive retrieval does not substitute unrelated news for a missing subject',async()=>{
  await save(article('ecosistemi'));
  await save(article('trasporti',{title:'TEST FIXTURE Collegamenti ferroviari',summary:'TEST FIXTURE. Nuovi orari dei treni.',context:'TEST FIXTURE. Servizio pubblico.',confirmed:[],categories:['trasporti']}));
  const missing=await answerQuestion('Spiegami il congresso di biotecnologia');
  assert.equal(missing.mode,'archive');assert.equal(missing.citations.length,0);
  assert.match(missing.answer,/non risultano notizie/i);
  const found=await answerQuestion('Spiegami gli ecosistemi');
  assert.deepEqual(found.citations.map(item=>item.articleId),['ecosistemi']);
  assert.equal((await getBudgetOverview()).callsToday,0);
});

test('metadata-only archive answers avoid presenting stored summaries as reporting',async()=>{
  await save(article('metadata',{originalContent:false,summary:'TEST FIXTURE DATO NON DOCUMENTATO NEL TESTO'}));
  const result=await answerQuestion('Spiegami ambiente');
  assert.equal(result.mode,'archive');assert.ok(!result.answer.includes('DATO NON DOCUMENTATO'));
  assert.match(result.answer,/titolo del feed ufficiale/i);assert.match(result.uncertainties.join(' '),/metadati/i);
});

test('archive cache notices new uncertainty even if the article timestamp is unchanged',async()=>{
  const value=article('uncertainty');await save(value);
  assert.equal((await answerQuestion('Spiegami ambiente','uncertainty')).cached,false);
  assert.equal((await answerQuestion('Spiegami ambiente','uncertainty')).cached,true);
  await save({...value,unconfirmed:['TEST FIXTURE. Dato contestato.']});
  const result=await answerQuestion('Spiegami ambiente','uncertainty');
  assert.equal(result.cached,false);assert.match(result.uncertainties.join(' '),/restano da chiarire/i);
});
test('public shared cache avoids repeat calls and never stores or sends the raw reader question',async()=>{
  await save(article('shared'));await enable();
  let calls=0;const secretQuestion='Spiegami ambiente TEST-QUESTION-PRIVATE-78251';
  globalThis.fetch=async(_url,init)=>{
    calls++;assert.ok(!String(init?.body).includes('TEST-QUESTION-PRIVATE-78251'));
    await new Promise(resolve=>setTimeout(resolve,30));return responseFor(init);
  };
  const results=await Promise.all([answerQuestion(secretQuestion,'shared'),answerQuestion('Mi spieghi ambiente in modo semplice?','shared')]);
  assert.equal(calls,1);assert.ok(results.every(result=>result.mode==='ai'));assert.ok(results.some(result=>result.cached));
  const rows=await query('SELECT payload FROM public_answer_cache');assert.equal(rows.length,1);assert.ok(!String(rows[0].payload).includes(secretQuestion));
  const overview=await getBudgetOverview();assert.equal(overview.callsToday,1);assert.equal(overview.inputTokens,100);assert.equal(overview.outputTokens,40);assert.equal(overview.webSearches,0);
});
test('cached answers are invalidated by a correction and never expose withdrawn articles',async()=>{
  const value=article('version');await save(value);await enable();let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;return responseFor(init);};
  assert.equal((await answerQuestion('Spiegami ambiente','version')).mode,'ai');
  await save({...value,title:'TEST FIXTURE Inventario corretto',updatedAt:new Date(Date.now()+1000).toISOString()});
  const corrected=await answerQuestion('Spiegami ambiente','version');assert.equal(corrected.cached,false);assert.equal(calls,2);assert.equal(corrected.citations[0].title,'TEST FIXTURE Inventario corretto');
  await save({...value,status:'withdrawn'});
  const withdrawn=await answerQuestion('Spiegami ambiente','version');assert.equal(withdrawn.citations.length,0);assert.ok(!withdrawn.answer.includes('Inventario corretto'));assert.equal(calls,2);
});
test('withdrawal during generation discards the in-flight answer and fabricated citations fail closed',async()=>{
  const value=article('inflight');await save(value);await enable();
  globalThis.fetch=async(_url,init)=>{await save({...value,status:'withdrawn'});return responseFor(init);};
  assert.equal((await answerQuestion('Spiegami ambiente','inflight')).citations.length,0);
  await save(value);await execute('DELETE FROM public_answer_cache');
  globalThis.fetch=async(_url,init)=>responseFor(init,true);
  const result=await answerQuestion('Spiegami ambiente','inflight');assert.equal(result.mode,'archive');
  assert.equal((await query('SELECT status FROM ai_usage ORDER BY created_at DESC LIMIT 1'))[0].status,'failed');
});
test('personal advice, safety mode and uncertain timeouts never trigger additional paid requests',async()=>{
  await save(article('safe'));await enable();let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('TEST FIXTURE simulated timeout');};
  const personal=await answerQuestion('Posso prendere un farmaco per la mia salute?');assert.equal(personal.mode,'archive');assert.equal(calls,0);
  assert.match(personal.uncertainties.join(' '),/consulenze personali/i);
  const failed=await answerQuestion('Spiegami ambiente','safe');assert.equal(failed.mode,'archive');assert.equal(calls,1);
  const budget=await getBudgetOverview();assert.ok(budget.chatSpentTodayUsd>0);assert.equal(budget.inputTokens,0);
  await execute('DELETE FROM public_answer_cache');
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify({...settings,safetyMode:true}),'global']);
  assert.equal((await answerQuestion('Spiegami ambiente','safe')).mode,'archive');assert.equal(calls,1);
});

test('a pause or disabled chat immediately returns archive mode instead of an earlier AI answer',async()=>{
  await save(article('pause'));await enable();let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;return responseFor(init);};
  assert.equal((await answerQuestion('Spiegami ambiente','pause')).mode,'ai');
  for(const change of [{paused:true},{chatEnabled:false},{safetyMode:true}]){
    await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify({...settings,...change}),'global']);
    assert.equal((await answerQuestion('Spiegami ambiente','pause')).mode,'archive');
  }
  assert.equal(calls,1);
});
test('chat endpoint checks origin, validates input, sets no-store and returns archive without a key',async()=>{
  await save(article('endpoint'));
  const req=(body:unknown,origin?:string)=>new Request('http://localhost:3000/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  assert.equal((await POST(req({question:'Quali fonti?'}))).status,403);
  assert.equal((await POST(req({question:'ab'},'http://localhost:3000'))).status,400);
  const result=await POST(req({question:'Quali sono le fonti?'},'http://localhost:3000'));
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).mode,'archive');
  const malformed=await POST(new Request('http://localhost:3000/api/chat',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{'}));
  assert.equal(malformed.status,400);assert.equal(malformed.headers.get('cache-control'),'no-store');
});

test('article and briefing context reload only public records and understand short follow-ups',async()=>{
  await save(article('context'));await save(article('second'));await save(article('private',{status:'review'}));
  const simple=await answerWithContext('Spiegamela meglio.',{articleSlug:'test-fixture-context'});
  assert.deepEqual(simple.citations.map(item=>item.articleId),['context']);assert.match(simple.answer,/Spiegazione già memorizzata/);
  const practical=await answerWithContext('Cosa cambia per i cittadini?',{articleId:'context'});
  assert.match(practical.answer,/Consulta il documento ufficiale/);
  const briefing=await answerWithContext('Quali sono le conseguenze?',{articleIds:['context','second','private']});
  assert.deepEqual(new Set(briefing.citations.map(item=>item.articleId)),new Set(['context','second']));
  assert.equal((await answerWithContext('Spiegamela meglio.',{articleId:'private'})).citations.length,0);
});

async function streamedProvider(init:RequestInit|undefined,invalid=false){
  const body=await responseFor(init,invalid).json();
  const raw=body.output[0].content[0].text;
  const encoder=new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({start(controller){
    const split=Math.floor(raw.length/2);
    for(const delta of [raw.slice(0,split),raw.slice(split)])controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'response.output_text.delta',delta})}\n\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'response.completed',response:body})}\n\n`));controller.close();
  }}),{headers:{'Content-Type':'text/event-stream'}});
}
test('real provider SSE emits checked claims progressively and shared cache does not fake a stream',async()=>{
  await save(article('stream'));await enable();let calls=0;const events:ChatStreamEvent[]=[];
  globalThis.fetch=async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).stream,true);return streamedProvider(init);};
  const result=await answerWithContext('Spiegamela meglio.',{articleId:'stream'},{emit:event=>events.push(event)});
  assert.equal(result.mode,'ai');assert.equal(events[0].type,'status');assert.equal(events.filter(event=>event.type==='delta').length,1);
  assert.equal(events.filter(event=>event.type==='delta').map(event=>event.type==='delta'?event.text:'').join(''),result.answer);
  const cachedEvents:ChatStreamEvent[]=[];
  assert.equal((await answerWithContext('Spiegamela meglio.',{articleId:'stream'},{emit:event=>cachedEvents.push(event)})).cached,true);
  assert.equal(calls,1);assert.deepEqual(cachedEvents,[]);assert.equal((await getBudgetOverview()).callsToday,1);
});
test('a streaming claim with invented sources is never emitted to the browser',async()=>{
  await save(article('bad-stream'));await enable();const events:ChatStreamEvent[]=[];
  globalThis.fetch=async(_url,init)=>streamedProvider(init,true);
  const result=await answerWithContext('Spiegamela meglio.',{articleId:'bad-stream'},{emit:event=>events.push(event)});
  assert.equal(result.mode,'archive');assert.equal(events.filter(event=>event.type==='delta').length,0);
  assert.equal((await query('SELECT status FROM ai_usage'))[0].status,'failed');
});
test('stopping a provider stream releases its lock, preserves uncertain cost and never caches an incomplete answer',async()=>{
  await save(article('stop-stream'));await enable();const abort=new AbortController();
  globalThis.fetch=async(_url,init)=>streamedProvider(init);
  await assert.rejects(answerWithContext('Spiegamela meglio.',{articleId:'stop-stream'},{signal:abort.signal,emit:event=>{if(event.type==='delta')abort.abort();}}),/abort/i);
  assert.equal((await query('SELECT * FROM public_answer_cache')).length,0);
  assert.equal((await query("SELECT * FROM pipeline_locks WHERE id LIKE 'chat:%'")).length,0);
  const usage=(await query('SELECT * FROM ai_usage'))[0];assert.equal(usage.status,'failed');assert.ok(Number(usage.actual_usd)>0);
});
test('SSE decoding handles split UTF-8 and a partial claim is not displayed before source IDs arrive',async()=>{
  const complete={text:'Perché il dato è pubblico.',sourceIds:['public:0']};
  assert.deepEqual(completeClaims('{"claims":[{"text":"Perché il dato è pubblico.","sourceIds":['),[]);
  assert.deepEqual(completeClaims(`{"claims":[${JSON.stringify(complete)},`),[complete]);
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify({type:'response.output_text.delta',delta:'città'})}\r\n\r\n`);
  const body=new ReadableStream<Uint8Array>({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
  const events=[];for await(const event of responseEvents(body))events.push(event);
  assert.equal(events[0].delta,'città');
});
test('streaming endpoint exposes explicit archive mode without a key and validates context bounds',async()=>{
  await save(article('ndjson'));
  const req=(data:unknown)=>new Request('http://localhost:3000/api/chat',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(data)});
  const response=await POST(req({question:'Spiegamela meglio.',articleId:'ndjson',stream:true}));
  assert.match(response.headers.get('content-type')||'',/application\/x-ndjson/);assert.equal(response.headers.get('cache-control'),'no-store');
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events.map(event=>event.type),['done']);assert.equal(events[0].response.mode,'archive');
  assert.equal((await POST(req({question:'Spiegami le notizie.',articleIds:Array(7).fill('ndjson'),stream:true}))).status,400);
});
