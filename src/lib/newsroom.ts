import { query } from './db';
import { getNews, getSettings, getSources } from './store';
import { getBudgetOverview, romeDayStart } from './budget';
import { getQueueCounts, listJobs } from './queue';
import { listActions } from './audit';
import { getHomepageEdition, getHomepageOverrides } from './homepage';
import { getWorkerRuntime, workerIsOnline, runNewsroomMonitoring } from './monitor';
import { isAIConfigured } from './ai';
import type { ModuleId, NewsroomOverview, NewsroomIncident } from './newsroom-types';
const modules:{id:ModuleId;name:string;description:string;mode:'deterministic'|'ai-assisted'}[]=[
  {id:'researcher',name:'AI Ricercatore',description:'Legge i connettori autorizzati e accoda le novità senza chiamate al modello.',mode:'deterministic'},
  {id:'verifier',name:'AI Verificatore',description:'Controlla provenienza, date, riscontri e rischi con regole verificabili. Non considera il numero di fonti una prova indipendente.',mode:'deterministic'},
  {id:'writer',name:'AI Redattore',description:'Prepara spiegazioni con Responses API quando chiave, diritti e budget lo consentono.',mode:'ai-assisted'},
  {id:'classifier',name:'AI Classificatore',description:'Normalizza categorie e territori documentati con regole; l’eventuale sintesi AI propone ulteriori categorie validate.',mode:'deterministic'},
  {id:'chief',name:'AI Caporedattore',description:'Ordina la homepage con priorità spiegabili, diversità degli argomenti e scelte del gestore.',mode:'deterministic'},
  {id:'updater',name:'AI Aggiornatore',description:'Raggruppa prudentemente gli sviluppi e conserva versioni, correzioni e identificativi.',mode:'deterministic'},
  {id:'seo',name:'AI SEO',description:'Controlla metadati, contenuti insufficienti e disponibilità dei link senza cambiare i fatti.',mode:'deterministic'},
  {id:'analyst',name:'AI Analista',description:'Osserva metriche aggregate e limiti di spesa senza usare ricavi o clic per scegliere le notizie.',mode:'deterministic'},
  {id:'supervisor',name:'AI Supervisore',description:'Rileva ritardi, code ed errori; consente solo recuperi previsti e controlli amministrativi.',mode:'deterministic'},
];
export async function getNewsroomOverview():Promise<NewsroomOverview> {
  await runNewsroomMonitoring();
  const [settings,sources,budget,counts,jobs,actions,runtime,edition,overrides,articles,incidentRows,moduleRows]=await Promise.all([getSettings(),getSources(),getBudgetOverview(),getQueueCounts(),listJobs(60),listActions(100),getWorkerRuntime(),getHomepageEdition(),getHomepageOverrides(),getNews({limit:1000}),query('SELECT * FROM newsroom_incidents ORDER BY last_seen_at DESC LIMIT 60'),query('SELECT module,MAX(created_at) AS last_action FROM newsroom_actions GROUP BY module')]);
  const workerOnline=workerIsOnline(runtime);
  const activeSources=sources.filter(source=>source.authorized&&source.enabled);
  const lastScanAt=activeSources.map(source=>source.lastCheckedAt).filter((value):value is string=>Boolean(value)).sort().at(-1)||null;
  const httpSchedulerFresh=process.env.SCHEDULER_MODE==='http'&&Boolean(lastScanAt&&Date.now()-new Date(lastScanAt).getTime()<settings.intervalMinutes*2*60_000+60_000);
  const online=workerOnline||httpSchedulerFresh;
  const nextScanAt=!settings.paused&&online&&lastScanAt?new Date(new Date(lastScanAt).getTime()+settings.intervalMinutes*60_000).toISOString():null;
  const lastByModule=new Map(moduleRows.map(row=>[String(row.module),String(row.last_action)]));
  const aiConfigured=isAIConfigured(settings.aiModel);
  const since=romeDayStart();
  const [discovered,verified,published,rejected,review,corrections,updated,views,topPages,categories,regions,links]=await Promise.all([
    query('SELECT COUNT(*) AS total FROM ingested_items WHERE imported_at>=?',[since]),
    query('SELECT payload FROM newsroom_verifications'),
    query('SELECT COUNT(*) AS total FROM events WHERE status=?',['published']),
    query('SELECT COUNT(*) AS total FROM events WHERE status=?',['rejected']),
    query('SELECT COUNT(DISTINCT event_id) AS total FROM editorial_reviews WHERE status=?',['pending']),
    query('SELECT COUNT(*) AS total FROM corrections'),
    query('SELECT COUNT(*) AS total FROM newsroom_actions WHERE action IN (?,?) AND created_at>=?',['article-updated','editorial-correct',since]),
    query('SELECT COALESCE(SUM(page_views),0) AS total FROM daily_metrics'),
    query('SELECT path,SUM(views) AS views,SUM(load_ms_sum) AS total_ms,SUM(load_samples) AS samples FROM page_metrics GROUP BY path ORDER BY SUM(views) DESC LIMIT 10'),
    query('SELECT category AS name,SUM(views) AS views FROM page_metrics WHERE category IS NOT NULL GROUP BY category ORDER BY SUM(views) DESC LIMIT 14'),
    query('SELECT region AS name,SUM(views) AS views FROM page_metrics WHERE region IS NOT NULL GROUP BY region ORDER BY SUM(views) DESC LIMIT 20'),
    query('SELECT url,status,http_status,checked_at FROM link_checks ORDER BY checked_at DESC LIMIT 30')
  ]);
  const incidents:NewsroomIncident[]=incidentRows.map(row=>({id:String(row.id),severity:row.severity as NewsroomIncident['severity'],status:row.status as NewsroomIncident['status'],module:row.module as ModuleId,title:String(row.title),details:String(row.details),firstSeenAt:String(row.first_seen_at),lastSeenAt:String(row.last_seen_at),automaticAction:row.automatic_action?String(row.automatic_action):null}));
  return {settings,status:{active:!settings.paused&&online,safetyMode:Boolean(settings.safetyMode),workerOnline,lastHeartbeatAt:runtime?.lastHeartbeatAt||null,lastScanAt,nextScanAt,activeSources:activeSources.length,sourcesInError:activeSources.filter(source=>source.lastError).length,apiConfigured:aiConfigured,currentRunId:runtime?.currentRunId||null},modules:modules.map(module=>({...module,lastActionAt:lastByModule.get(module.id)||null,status:settings.paused||module.id==='writer'&&(!aiConfigured||settings.safetyMode)?'disabled':module.id==='researcher'&&activeSources.some(source=>source.lastError)||module.id==='supervisor'&&!online?'attention':module.id==='writer'&&Number(counts.DRAFT||0)>0||module.id==='verifier'&&Number(counts.VERIFYING||0)>0?'working':'ready'})),queue:{counts,jobs},editorial:{discoveredToday:Number(discovered[0]?.total||0),verified:verified.filter(row=>{try{return JSON.parse(String(row.payload)).status==='CONFIRMED';}catch{return false;}}).length,published:Number(published[0]?.total||0),updatedToday:Number(updated[0]?.total||0),rejected:Number(rejected[0]?.total||0),review:Number(review[0]?.total||0),corrections:Number(corrections[0]?.total||0)},budget,actions,incidents,homepage:{edition,articles:articles.map(({id,slug,title,categories,relevance})=>({id,slug,title,categories,relevance})),overrides},analytics:{enabled:process.env.ANALYTICS_ENABLED==='true',pageViews:Number(views[0]?.total||0),uniqueVisitors:null,organicTraffic:null,adRevenue:null,topPages:topPages.map(row=>({path:String(row.path),views:Number(row.views),averageLoadMs:Number(row.samples)>0?Math.round(Number(row.total_ms)/Number(row.samples)):null})),categories:categories.map(row=>({name:String(row.name),views:Number(row.views)})),regions:regions.map(row=>({name:String(row.name),views:Number(row.views)}))},links:links.map(row=>({url:String(row.url),status:String(row.status),httpStatus:row.http_status===null?null:Number(row.http_status),checkedAt:String(row.checked_at)}))};
}
