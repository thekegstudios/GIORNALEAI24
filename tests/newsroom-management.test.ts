import { test,after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH=':memory:';
process.env.ANALYTICS_ENABLED='false';
const {closeDatabase,execute,query}=await import('../src/lib/db');
const {getSettings,updateSettings}=await import('../src/lib/store');
const {rankHomepage,setHomepageOverride,rebuildHomepageEdition,getHomepageSelection}=await import('../src/lib/homepage');
const {getNewsroomOverview}=await import('../src/lib/newsroom');
const {recordPublicPageView}=await import('../src/lib/metrics');
const {initializeGeography,resolveSourceGeography}=await import('../src/lib/geography');
after(closeDatabase);
function article(id:string,category='ambiente',relevance=55){const now=new Date().toISOString();return {id,slug:id,title:`TEST ISOLATO ${id}: documento istituzionale`,summary:'Metadati di prova nel database isolato.',context:'',categories:[category],region:null,province:null,municipality:null,locationEvidence:null,relevance,status:'published',publishedAt:now,updatedAt:now,confirmed:[],unconfirmed:[],explanations:{simple:'',detailed:'',causes:'',consequences:'',practical:''},citations:[{sourceId:'ispra',sourceName:'ISPRA',url:`https://www.isprambiente.gov.it/it/${id}`,title:id,publishedAt:now,checkedAt:now,license:'CC BY 4.0',termsUrl:'https://www.isprambiente.gov.it/it/note-legali'}],timeline:[],reviewReasons:[],aiGenerated:false,originalContent:false} as import('../src/lib/types').Article;}
test('homepage choices explain diversity and respect pins and exclusions without traffic inputs',async()=>{
  const a=article('test-a'),b=article('test-b'),c=article('test-c','economia',54);
  const ranked=rankHomepage([a,b,c],[],new Set(['ispra']));assert.equal(ranked[1].articleId,'test-c');assert(ranked.every(entry=>entry.reasons.length));
  const fixed=rankHomepage([a,b,c],[{articleId:b.id,position:1,excluded:false,reason:'Scelta editoriale documentata'},{articleId:a.id,position:null,excluded:true,reason:'Esclusione motivata dalla redazione'}],new Set(['ispra']));assert.equal(fixed[0].articleId,b.id);assert(!fixed.some(entry=>entry.articleId===a.id));
  for(const item of [a,b,c])await execute('INSERT INTO events (id,slug,title,status,payload,published_at,updated_at) VALUES (?,?,?,?,?,?,?)',[item.id,item.slug,item.title,item.status,JSON.stringify(item),item.publishedAt,item.updatedAt]);
  await setHomepageOverride({articleId:b.id,position:1,excluded:false,reason:'Priorità di servizio documentata'});
  await rebuildHomepageEdition();assert.equal((await getHomepageSelection())[0].id,b.id);
  await execute('UPDATE events SET status=? WHERE id=?',['withdrawn',b.id]);assert(!(await getHomepageSelection()).some(item=>item.id===b.id));
});
test('control center reports real queue, disabled API and unavailable visitor/revenue metrics honestly',async()=>{
  await updateSettings({safetyMode:true,monthlyBudgetUsd:5,chatDailyBudgetUsd:0,chatEnabled:false});
  const data=await getNewsroomOverview();assert.equal(data.settings.safetyMode,true);assert.equal(data.budget.monthlyBudgetUsd,5);assert.equal(data.analytics.uniqueVisitors,null);assert.equal(data.analytics.adRevenue,null);assert.equal(data.modules.length,9);assert.equal(data.status.workerOnline,false);
  await updateSettings({safetyMode:false});
});
test('optional analytics discard queries, private paths and draft identifiers',async()=>{
  assert.equal(await recordPublicPageView('/'),false);process.env.ANALYTICS_ENABLED='true';
  assert.equal(await recordPublicPageView('/admin'),false);assert.equal(await recordPublicPageView('/notizie/unknown-private-id'),false);
  assert.equal(await recordPublicPageView('/regioni/sicilia?email=never-store-this#fragment',120),true);
  const rows=await query('SELECT path,region,load_ms_sum FROM page_metrics');assert.equal(rows.length,1);assert.equal(rows[0].path,'/regioni/sicilia');assert.equal(rows[0].region,'sicilia');assert.equal(rows[0].load_ms_sum,120);process.env.ANALYTICS_ENABLED='false';
});
test('geographic registry does not locate an event from a city in a source name',async()=>{
  await initializeGeography();assert.equal(Number((await query('SELECT COUNT(*) AS total FROM geographic_units WHERE level=?',['region']))[0].total),20);
  const source=(await import('../src/lib/catalog')).INITIAL_SOURCES.find(item=>item.id==='ispra')!;
  assert.equal((await resolveSourceGeography({...source,name:'Fonte con Roma nel nome'})).level,'undetermined');
  assert.equal((await resolveSourceGeography({...source,region:'Sicilia'})).region,'sicilia');
});
