import { randomUUID } from 'node:crypto';
import { execute, query } from './db';
import { getSettings, getSources, getNews } from './store';
import { getQueueCounts } from './queue';
import { getBudgetOverview } from './budget';
import { logAction } from './audit';
import { safePublicUrl } from './editorial';
import type { ModuleId, NewsroomIncident } from './newsroom-types';
export interface WorkerRuntime { lastHeartbeatAt:string; currentRunId:string|null; state:'online'|'stopped'; startedAt?:string }
export async function getWorkerRuntime():Promise<WorkerRuntime|null> {
  const row=(await query('SELECT payload FROM newsroom_runtime WHERE id=?',['worker']))[0];
  return row?JSON.parse(String(row.payload)):null;
}
export async function recordHeartbeat(currentRunId:string|null=null,stopped=false) {
  const now=new Date().toISOString();
  const previous=await getWorkerRuntime();
  const value:WorkerRuntime={lastHeartbeatAt:now,currentRunId,state:stopped?'stopped':'online',startedAt:previous?.startedAt||now};
  await execute('INSERT INTO newsroom_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',['worker',JSON.stringify(value),now]);
}
export function workerIsOnline(runtime:WorkerRuntime|null,now=Date.now()) {return Boolean(runtime?.state==='online'&&now-new Date(runtime.lastHeartbeatAt).getTime()<90_000);}
interface IncidentInput {fingerprint:string;severity:NewsroomIncident['severity'];module:ModuleId;title:string;details:string;automaticAction?:string}
async function recordIncident(input:IncidentInput) {
  const now=new Date().toISOString();
  const previous=(await query('SELECT id,status FROM newsroom_incidents WHERE fingerprint=?',[input.fingerprint]))[0];
  await execute('INSERT INTO newsroom_incidents (id,fingerprint,severity,status,module,title,details,first_seen_at,last_seen_at,resolved_at,automatic_action) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET severity=excluded.severity,status=excluded.status,title=excluded.title,details=excluded.details,last_seen_at=excluded.last_seen_at,resolved_at=NULL,automatic_action=excluded.automatic_action',[previous?.id||randomUUID(),input.fingerprint,input.severity,'open',input.module,input.title,input.details,now,now,null,input.automaticAction||null]);
  if(!previous||previous.status==='resolved')await logAction('supervisor','incident-opened',String(previous?.id||input.fingerprint),{title:input.title,severity:input.severity,cause:input.details,automaticAction:input.automaticAction||'Nessuna azione distruttiva autorizzata'});
}
export async function resolveIncident(id:string,automatic=false) {
  const row=(await query('SELECT id,status,title FROM newsroom_incidents WHERE id=?',[id]))[0];
  if(!row)throw new Error('Anomalia non trovata');
  if(row.status==='resolved')return;
  await execute('UPDATE newsroom_incidents SET status=?,resolved_at=? WHERE id=?',['resolved',new Date().toISOString(),id]);
  await logAction('supervisor',automatic?'incident-recovered':'incident-acknowledged',id,{title:row.title,automatic});
}
export async function runNewsroomMonitoring({checkLinks=false}:{checkLinks?:boolean}={}) {
  const [settings,sources,queue,budget,runtime]=await Promise.all([getSettings(),getSources(),getQueueCounts(),getBudgetOverview(),getWorkerRuntime()]);
  const incidents:IncidentInput[]=[];
  const now=Date.now();
  const active=sources.filter(source=>source.authorized&&source.enabled);
  for(const source of active)if(source.lastError)incidents.push({fingerprint:`source:${source.id}`,severity:'warning',module:'researcher',title:`Fonte non raggiungibile: ${source.name}`,details:source.lastError,automaticAction:'Retry limitati; sospensione temporanea dopo errori ripetuti. Nessun aggiramento delle restrizioni.'});
  if(!settings.paused&&process.env.SCHEDULER_MODE!=='http'&&!workerIsOnline(runtime))incidents.push({fingerprint:'worker:offline',severity:'critical',module:'supervisor',title:runtime?'Heartbeat del worker assente':'Worker non ancora avviato',details:runtime?`Ultima presenza registrata: ${runtime.lastHeartbeatAt}. Verificare il processo e il database.`:'Nessuna presenza registrata. Avviare il servizio worker indipendente dalle visite.',automaticAction:'Segnalazione nel pannello; nessun avvio di processi o modifica di credenziali.'});
  const scanTimes=active.map(source=>source.lastCheckedAt?new Date(source.lastCheckedAt).getTime():0);
  const lastScan=Math.max(0,...scanTimes);
  if(!settings.paused&&lastScan&&now-lastScan>(settings.intervalMinutes*2*60_000+60_000))incidents.push({fingerprint:'scheduler:late',severity:'critical',module:'supervisor',title:'Controllo delle fonti in ritardo',details:`L'ultima scansione risale a ${new Date(lastScan).toISOString()}; intervallo configurato ${settings.intervalMinutes} minuti.`,automaticAction:'Segnalazione per controllare worker, scheduler e connettività.'});
  const queued=Object.entries(queue).filter(([state])=>['DISCOVERED','NORMALIZED','VERIFYING','DRAFT','APPROVED'].includes(state)).reduce((sum,[,count])=>sum+Number(count||0),0);
  if(queued>Math.max(25,settings.maxItemsPerRun*10))incidents.push({fingerprint:'queue:backlog',severity:'warning',module:'analyst',title:'Elementi in coda oltre la soglia',details:`${queued} elementi da elaborare; limite ${settings.maxItemsPerRun} per ciclo. Valutare capacità e budget prima di aumentare i limiti.`});
  if(Number(queue.FAILED||0)>0)incidents.push({fingerprint:'queue:failed',severity:'warning',module:'supervisor',title:'Elaborazioni non riuscite',details:`${queue.FAILED} job hanno esaurito i tentativi. Il pannello permette un nuovo tentativo esplicito.`});
  if(budget.warning)incidents.push({fingerprint:'budget:near-limit',severity:'warning',module:'analyst',title:'Budget AI vicino al limite',details:`Spesa stimata oggi $${budget.spentTodayUsd.toFixed(4)} su $${budget.dailyBudgetUsd}; mese $${budget.spentMonthUsd.toFixed(4)} su $${budget.monthlyBudgetUsd}.`,automaticAction:'Le prenotazioni applicano i limiti. RSS e contenuti già salvati restano disponibili.'});
  const aiFailures=Number((await query('SELECT COUNT(*) AS total FROM ai_usage WHERE status=? AND created_at>=?',['failed',new Date(now-24*3600_000).toISOString()]))[0]?.total||0);
  if(aiFailures)incidents.push({fingerprint:'ai:failures',severity:'warning',module:'writer',title:'Errori recenti del servizio AI',details:`${aiFailures} richieste con esito non riuscito nelle ultime 24 ore. Verificare chiave, quota, timeout e modello prima di riprovare.`});
  const pending=await query('SELECT candidate FROM editorial_reviews WHERE status=?',['pending']);
  for(const row of pending){try{const article=JSON.parse(String(row.candidate));if(article.verification?.status==='CONTRADICTED')incidents.push({fingerprint:`contradiction:${article.id}`,severity:'critical',module:'verifier',title:'Possibile smentita in revisione',details:`La nuova versione di “${String(article.title).slice(0,180)}” contiene prove discordanti; serve una decisione editoriale e, quando necessario, una correzione pubblica.`});}catch{/* Corrupted payloads are handled by job validation. */}}
  const duplicates=await query('SELECT title,COUNT(*) AS total FROM events WHERE status=? GROUP BY title HAVING COUNT(*)>1',['published']);
  if(duplicates.length)incidents.push({fingerprint:'events:duplicate-headlines',severity:'info',module:'updater',title:'Titoli ripetuti da esaminare',details:`${duplicates.length} gruppi con titolo uguale. Eventi in date diverse possono essere distinti: nessuna fusione o cancellazione automatica.`});
  const present=new Set(incidents.map(incident=>incident.fingerprint));
  for(const incident of incidents)await recordIncident(incident);
  for(const previous of await query('SELECT id,fingerprint FROM newsroom_incidents WHERE status=?',['open']))if(!present.has(String(previous.fingerprint)))await resolveIncident(String(previous.id),true);
  if(checkLinks)await checkSourceLinks();
  const previous=(await query('SELECT payload FROM newsroom_runtime WHERE id=?',['monitor']))[0];
  const monitorState={incidentCount:incidents.length,queued,apiFailures:aiFailures,budgetWarning:budget.warning};
  if(!previous||String(previous.payload)!==JSON.stringify(monitorState))await logAction('analyst','operational-analysis',null,{...monitorState,pageTrafficUsedForEditorialRanking:false});
  await execute('INSERT INTO newsroom_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',['monitor',JSON.stringify(monitorState),new Date().toISOString()]);
}
export async function checkSourceLinks() {
  const [news,sources]=await Promise.all([getNews({limit:1000}),getSources()]);
  const hosts=new Set(sources.filter(source=>source.authorized&&source.homepage).map(source=>new URL(source.homepage).hostname));
  const checked=new Map((await query('SELECT url,checked_at FROM link_checks')).map(row=>[String(row.url),String(row.checked_at)]));
  const urls=[...new Set(news.flatMap(article=>article.citations.map(citation=>citation.url)))].filter(url=>safePublicUrl(url)&&hosts.has(new URL(url).hostname)&&(!checked.has(url)||Date.now()-new Date(checked.get(url)!).getTime()>24*3600_000)).slice(0,3);
  for(const url of urls){
    let status='unknown',httpStatus:number|null=null,error:string|null=null;
    try{const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'GiornaleAI24/0.1 (link availability check)'}});httpStatus=response.status;status=response.ok?'ok':[404,410].includes(response.status)?'broken':[401,403,429,405].includes(response.status)?'restricted':'unknown';await response.body?.cancel();}catch(caught){error=caught instanceof Error?caught.message:'Connessione non riuscita';status='unreachable';}
    const checkedAt=new Date().toISOString();
    await execute('INSERT INTO link_checks (url,status,http_status,checked_at,error) VALUES (?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,checked_at=excluded.checked_at,error=excluded.error',[url,status,httpStatus,checkedAt,error]);
    await logAction('seo','source-link-checked',null,{url,status,httpStatus,checkedAt});
  }
}
