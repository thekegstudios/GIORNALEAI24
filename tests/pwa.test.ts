import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import manifest from '../src/app/manifest';
import { offlineArticleAllowed,renderOfflineArticle } from '../src/lib/offline-article';
import { INITIAL_SOURCES } from '../src/lib/catalog';
import type { Article } from '../src/lib/types';
const origin='https://ai24.test';
const now=new Date().toISOString();
const fixture:Article={id:'fixture',slug:'test-fixture',title:'TEST FIXTURE Titolo <script>alert(1)</script>',summary:'TEST FIXTURE sintesi privata al provider <img src=x onerror=alert(1)>',context:'TEST FIXTURE contesto',categories:['ambiente'],region:null,province:null,municipality:null,locationEvidence:null,relevance:30,status:'published',publishedAt:now,updatedAt:now,confirmed:['TEST FIXTURE fatto attribuito'],unconfirmed:[],explanations:{simple:'TEST FIXTURE spiegazione',detailed:'',causes:'',consequences:'',practical:''},citations:[{sourceId:'ispra',sourceName:'ISPRA',url:'https://www.isprambiente.gov.it/test-fixture',title:'TEST FIXTURE fonte',publishedAt:now,checkedAt:now,license:'CC BY 4.0',termsUrl:'https://www.isprambiente.gov.it/it/note-legali'}],timeline:[],reviewReasons:[],aiGenerated:false,originalContent:true};
test('offline documents are standalone, dated, escaped and use current source permissions',()=>{
  const html=renderOfflineArticle(fixture,INITIAL_SOURCES,now)!;
  assert.match(html,/COPIA SALVATA/);assert.match(html,/NON È UN AGGIORNAMENTO IN TEMPO REALE/);assert.match(html,/CC BY 4.0/);
  assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script'));assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('/api/'));assert.ok(!html.includes('__next'));
  assert.equal(offlineArticleAllowed({...fixture,status:'review'},INITIAL_SOURCES),false);
  assert.equal(renderOfflineArticle(fixture,INITIAL_SOURCES.map(source=>({...source,authorized:false})),now),null);
  const metadata=renderOfflineArticle({...fixture,originalContent:false},INITIAL_SOURCES,now)!;
  assert.ok(!metadata.includes(fixture.summary));assert.match(metadata,/soltanto il titolo/);
  const deniedSummary=renderOfflineArticle(fixture,INITIAL_SOURCES.map(source=>({...source,allowSummary:false})),now)!;
  assert.ok(!deniedSummary.includes('TEST FIXTURE contesto'));assert.match(deniedSummary,/soltanto il titolo/);
});
test('manifest contains local installable icons and preserves identity',async()=>{
  const app=manifest();assert.equal(app.name,'GIORNALE AI24 — by KEG Studios');assert.equal(app.display,'standalone');assert.equal(app.start_url,'/');assert.equal(app.scope,'/');
  assert.ok(app.icons?.some(icon=>icon.sizes==='192x192'));assert.ok(app.icons?.some(icon=>icon.sizes==='512x512'));
  for(const size of [192,512]){const png=await readFile(`public/brand/ai24-icon-${size}.png`);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
  const apple=await readFile('src/app/apple-icon.png');assert.equal(apple.readUInt32BE(16),180);
});
type Listener=(event:any)=>void;
async function harness(){
  const handlers=new Map<string,Listener>();const stores=new Map<string,Map<string,Response>>();
  const key=(request:Request|string)=>new URL(typeof request==='string'?request:request.url,origin).href;
  const cacheStorage={async keys(){return [...stores.keys()];},async delete(name:string){return stores.delete(name);},async open(name:string){if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name)!;return {async put(request:Request|string,response:Response){values.set(key(request),response.clone());},async match(request:Request|string){return values.get(key(request))?.clone();},async delete(request:Request|string){return values.delete(key(request));},async keys(){return [...values.keys()].map(url=>new Request(url));}};}};
  let fetcher:(input:any,init?:RequestInit)=>Promise<Response>=async()=>{throw new Error('TEST offline');};
  const context=vm.createContext({URL,Request,Response,TextEncoder,AbortSignal,Date,Promise,caches:cacheStorage,fetch:(input:any,init?:RequestInit)=>fetcher(input,init),self:{location:{origin},addEventListener(type:string,listener:Listener){handlers.set(type,listener);},skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
  vm.runInContext(await readFile('public/sw.js','utf8'),context);
  async function message(data:unknown,source='/notizie/test-fixture'){
    let pending:Promise<void>|undefined,result:any;
    handlers.get('message')!({data,source:{url:`${origin}${source}`},ports:[{postMessage(value:unknown){result=value;}}],waitUntil(work:Promise<void>){pending=work;}});
    await pending;return result;
  }
  async function navigation(path:string,method='GET',mode='navigate'){
    let work:Promise<Response>|undefined;
    handlers.get('fetch')!({request:{url:`${origin}${path}`,method,mode},respondWith(promise:Promise<Response>){work=promise;},waitUntil(){}});
    return work?await work:null;
  }
  return {message,navigation,cacheStorage,stores,setFetch(fn:typeof fetcher){fetcher=fn;}};
}
function snapshot(slug:string,savedAt=now){return new Response('<!doctype html><p>TEST FIXTURE COPIA SALVATA</p>',{headers:{'Content-Type':'text/html','X-AI24-Offline':'article','X-AI24-Article-Slug':slug,'X-AI24-Article-Title':encodeURIComponent(`TEST FIXTURE ${slug}`),'X-AI24-Offline-Saved-At':savedAt,'X-AI24-Article-Updated-At':now}});}
test('service worker never intercepts private/live paths, non-GET, queries or API data',async()=>{
  const sw=await harness();let calls=0;sw.setFetch(async()=>{calls++;return new Response('PRIVATE DATA');});
  for(const path of ['/api/admin','/api/chat','/admin','/admin/login','/carburanti','/carburanti/prezzi','/sport','/sport/calcio','/notizie/test-fixture?token=secret'])assert.equal(await sw.navigation(path),null,path);
  assert.equal(await sw.navigation('/notizie/test-fixture','POST'),null);assert.equal(await sw.navigation('/api/chat','POST','cors'),null);assert.equal(calls,0);assert.equal(sw.stores.size,0);
});
test('service worker caches an article only after explicit save and serves its dated snapshot only offline',async()=>{
  const sw=await harness();sw.setFetch(async()=>new Response('<p>ONLINE HTML NOT SAVED</p>'));
  assert.match(await(await sw.navigation('/notizie/test-fixture'))!.text(),/ONLINE/);
  assert.equal((await sw.message({type:'LIST_ARTICLES'})).articles.length,0);
  sw.setFetch(async(input,init)=>{assert.equal(input,'/offline-articoli/test-fixture');assert.equal(init?.credentials,'omit');assert.equal(init?.cache,'no-store');return snapshot('test-fixture');});
  const saved=await sw.message({type:'SAVE_ARTICLE',slug:'test-fixture',body:'CLIENT INJECTION MUST NOT BE CACHED'});assert.equal(saved.ok,true);assert.equal(saved.articles.length,1);
  sw.setFetch(async()=>{throw new Error('TEST offline');});
  const offline=await sw.navigation('/notizie/test-fixture');assert.match(await offline!.text(),/COPIA SALVATA/);
  const index=await sw.navigation('/offline');assert.equal(index!.status,503);assert.match(await index!.text(),/TEST FIXTURE test-fixture/);
  assert.equal((await sw.message({type:'CLEAR_ARTICLES'})).articles.length,0);
});
test('private clients, invalid slugs, revoked snapshots and expired copies cannot enter or remain in cache',async()=>{
  const sw=await harness();let calls=0;sw.setFetch(async()=>{calls++;return new Response(null,{status:404});});
  assert.equal(await sw.message({type:'SAVE_ARTICLE',slug:'test-fixture'},'/admin'),undefined);assert.equal(calls,0);
  assert.equal((await sw.message({type:'SAVE_ARTICLE',slug:'../api/admin'})).ok,false);assert.equal(calls,0);
  assert.equal((await sw.message({type:'SAVE_ARTICLE',slug:'test-fixture'})).ok,false);
  sw.setFetch(async()=>snapshot('test-fixture',new Date(Date.now()-8*86400000).toISOString()));
  assert.equal((await sw.message({type:'SAVE_ARTICLE',slug:'test-fixture'})).articles.length,0);
});
test('an online withdrawal or correction invalidates a formerly saved public article',async()=>{
  const sw=await harness();sw.setFetch(async()=>snapshot('test-fixture'));await sw.message({type:'SAVE_ARTICLE',slug:'test-fixture'});
  sw.setFetch(async(_input,init)=>init?.method==='HEAD'?new Response(null,{status:404}):new Response('<p>PUBLIC WITHDRAWAL NOTICE</p>'));
  const online=await sw.navigation('/notizie/test-fixture');assert.match(await online!.text(),/WITHDRAWAL/);assert.equal((await sw.message({type:'LIST_ARTICLES'})).articles.length,0);
});
test('the saved article limit removes the oldest copies and retains at most twenty explicit saves',async()=>{
  const sw=await harness();sw.setFetch(async(input)=>snapshot(String(input).split('/').at(-1)!));
  for(let i=0;i<22;i++)await sw.message({type:'SAVE_ARTICLE',slug:`fixture-${i}`});
  const articles=(await sw.message({type:'LIST_ARTICLES'})).articles;
  assert.equal(articles.length,20);assert.ok(!articles.some((item:{slug:string})=>item.slug==='fixture-0'));assert.ok(articles.some((item:{slug:string})=>item.slug==='fixture-21'));
});
