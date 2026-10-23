import { randomUUID } from 'node:crypto';
import { execute, query, transaction } from './db';
import { DEFAULT_SETTINGS } from './catalog';
import { isAIConfigured, romeDate, romeDayStart } from './ai';
import type { AdminData, Article, Correction, DailyDigest, NewsFilters, PipelineStatus, RunResult, Settings, Source } from './types';

function payload<T>(row:Record<string,unknown>):T{return JSON.parse(String(row.payload)) as T;}
function recordHumanVerification(article:Article,attested:boolean,at:string){
  const report=article.verification;if(!report)return;
  const evidence=[...new Map(report.claims.flatMap(claim=>claim.evidence).map(reference=>[`${reference.sourceId}:${reference.url}:${reference.itemHash}`,reference])).values()];
  const referencesValid=evidence.length>0&&evidence.every(reference=>article.citations.some(citation=>citation.sourceId===reference.sourceId&&citation.url===reference.url));
  const verified=attested&&article.originalContent&&article.confirmed.length>0&&article.unconfirmed.length===0&&referencesValid;
  const texts=[...new Set([...article.confirmed,article.summary].filter(Boolean))];
  article.verification={...report,checkedAt:at,status:verified?'CONFIRMED':article.unconfirmed.length?'DEVELOPING':'NEEDS_VERIFICATION',claims:texts.map(text=>({text,status:verified?'CONFIRMED':'NEEDS_VERIFICATION',evidence:report.claims.find(claim=>claim.text===text)?.evidence||evidence})),checks:[...report.checks.filter(check=>check.name!=='human-semantic-review'),{name:'human-semantic-review',passed:verified,detail:verified?'Un amministratore ha attestato la verifica delle affermazioni e delle fonti della versione corrente.':'Pubblicazione senza attestazione di verifica semantica della versione corrente.'}],explanation:verified?'Verifica delle affermazioni attestata esplicitamente da un amministratore; fonti e revisione sono registrate.':'Provenienza e approvazione della pubblicazione non equivalgono a verifica delle affermazioni.'};
}
export async function getSettings():Promise<Settings>{const rows=await query('SELECT payload FROM settings WHERE id=?',['global']);return {...DEFAULT_SETTINGS,...(rows[0]?payload<Settings>(rows[0]):{})};}
export async function updateSettings(partial:Partial<Settings>):Promise<Settings>{return transaction(async()=>{
  await execute('UPDATE settings SET payload=payload WHERE id=?',['global']);
  const current=await getSettings();
  const next={...current};
  if(typeof partial.paused==='boolean')next.paused=partial.paused;
  if(typeof partial.autoPublish==='boolean')next.autoPublish=partial.autoPublish;
  if(typeof partial.safetyMode==='boolean')next.safetyMode=partial.safetyMode;
  if(typeof partial.chatEnabled==='boolean')next.chatEnabled=partial.chatEnabled;
  if(typeof partial.intervalMinutes==='number'&&Number.isInteger(partial.intervalMinutes)&&partial.intervalMinutes>=5&&partial.intervalMinutes<=1440)next.intervalMinutes=partial.intervalMinutes;
  if(typeof partial.maxItemsPerRun==='number'&&Number.isInteger(partial.maxItemsPerRun)&&partial.maxItemsPerRun>=1&&partial.maxItemsPerRun<=25)next.maxItemsPerRun=partial.maxItemsPerRun;
  if(typeof partial.dailyBudgetUsd==='number'&&Number.isFinite(partial.dailyBudgetUsd)&&partial.dailyBudgetUsd>=0&&partial.dailyBudgetUsd<=100)next.dailyBudgetUsd=partial.dailyBudgetUsd;
  if(typeof partial.monthlyBudgetUsd==='number'&&Number.isFinite(partial.monthlyBudgetUsd)&&partial.monthlyBudgetUsd>=0&&partial.monthlyBudgetUsd<=3000)next.monthlyBudgetUsd=partial.monthlyBudgetUsd;
  if(typeof partial.chatDailyBudgetUsd==='number'&&Number.isFinite(partial.chatDailyBudgetUsd)&&partial.chatDailyBudgetUsd>=0&&partial.chatDailyBudgetUsd<=10)next.chatDailyBudgetUsd=partial.chatDailyBudgetUsd;
  if(typeof partial.aiModel==='string'&&/^[a-zA-Z0-9._:-]{1,100}$/.test(partial.aiModel))next.aiModel=partial.aiModel;
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(next),'global']);
  const {logAction}=await import('./audit');
  await logAction('supervisor','settings-updated','global',{changes:Object.fromEntries(Object.entries(next).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(current[key as keyof Settings]))),actor:'administrator'});
  return next;
});}
export async function getSources():Promise<Source[]>{return (await query('SELECT payload FROM sources ORDER BY id')).map(row=>payload<Source>(row));}
export async function setSourceEnabled(id:string,enabled:boolean):Promise<void>{return transaction(async()=>{
  await execute('UPDATE sources SET payload=payload WHERE id=?',[id]);
  const rows=await query('SELECT payload FROM sources WHERE id=?',[id]);if(!rows[0])throw new Error('Fonte non trovata');
  const source=payload<Source>(rows[0]);if(enabled&&(!source.authorized||!source.feedUrl))throw new Error('Occorrono diritti documentati e un feed configurato');
  source.enabled=enabled;await execute('UPDATE sources SET payload=? WHERE id=?',[JSON.stringify(source),id]);
  const {logAction}=await import('./audit');await logAction('researcher',enabled?'source-enabled':'source-disabled',id,{actor:'administrator',source:source.name});
});}
export async function getNews(filters:NewsFilters={}):Promise<Article[]>{
  const rows=await query('SELECT payload FROM events WHERE status=? ORDER BY published_at DESC',['published']);
  const normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const search=normalize((filters.query||'').slice(0,200));
  return rows.map(row=>payload<Article>(row)).filter(article=>
    (!filters.category||article.categories.includes(filters.category as Article['categories'][number]))&&
    (!filters.region||normalize(article.region||'')===normalize(filters.region))&&
    (!filters.province||normalize(article.province||'')===normalize(filters.province))&&
    (!filters.municipality||normalize(article.municipality||'')===normalize(filters.municipality))&&
    (!search||normalize(`${article.title} ${article.summary}`).includes(search))
  ).slice(0,Math.max(1,Math.min(filters.limit||100,1000)));
}
export async function getArticle(slug:string):Promise<Article|null>{const rows=await query('SELECT payload FROM events WHERE slug=? AND status=?',[slug,'published']);return rows[0]?payload<Article>(rows[0]):null;}
export async function getStatus():Promise<PipelineStatus>{const [runs,sources,count,settings]=await Promise.all([query('SELECT payload FROM pipeline_runs ORDER BY started_at DESC LIMIT 1'),getSources(),query('SELECT COUNT(*) AS total FROM events WHERE status=?',['published']),getSettings()]);return {lastRun:runs[0]?payload<RunResult>(runs[0]):null,activeSources:sources.filter(source=>source.authorized&&source.enabled).length,totalPublished:Number(count[0]?.total||0),aiConfigured:isAIConfigured(settings.aiModel),paused:settings.paused,intervalMinutes:settings.intervalMinutes};}
export async function getDigest():Promise<DailyDigest>{const date=romeDate();const rows=await query('SELECT payload FROM daily_digests WHERE id=?',[date]);if(!rows[0])return {date,generatedAt:'',items:[]};const digest=payload<DailyDigest>(rows[0]);const visible=new Map((await getNews({limit:1000})).map(article=>[article.id,article]));digest.items=digest.items.filter(item=>visible.has(item.id)).map(item=>{const current=visible.get(item.id)!;return {...item,title:current.title,summary:current.summary};});return digest;}
export async function getCorrections():Promise<Correction[]>{return (await query('SELECT payload FROM corrections ORDER BY created_at DESC LIMIT 100')).map(row=>payload<Correction>(row));}
export async function getAdminData():Promise<AdminData>{const [articles,sources,runs,settings,today,usage,views]=await Promise.all([query('SELECT payload FROM events ORDER BY updated_at DESC LIMIT 250'),getSources(),query('SELECT payload FROM pipeline_runs ORDER BY started_at DESC LIMIT 30'),getSettings(),query('SELECT COUNT(*) AS total FROM ingested_items WHERE imported_at>=?',[romeDayStart()]),query('SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(CASE WHEN status=? THEN reserved_usd ELSE actual_usd END),0) AS cost FROM ai_usage WHERE day=?',['reserved',romeDate()]),query('SELECT COALESCE(SUM(page_views),0) AS total FROM daily_metrics')]);
  const list=articles.map(row=>payload<Article>(row));
  // A sensitive update remains a separate review candidate while the last approved public version stays visible.
  const pending=await query('SELECT candidate FROM editorial_reviews WHERE status=? ORDER BY created_at DESC',['pending']);
  const represented=new Set<string>();
  for(const row of pending){const candidate=JSON.parse(String(row.candidate)) as Article;if(represented.has(candidate.id))continue;represented.add(candidate.id);const index=list.findIndex(article=>article.id===candidate.id);if(index>=0)list[index]=candidate;else list.push(candidate);}
  return {articles:list,sources,runs:runs.map(row=>payload<RunResult>(row)),settings,metrics:{collectedToday:Number(today[0]?.total||0),published:Number((await query('SELECT COUNT(*) AS total FROM events WHERE status=?',['published']))[0]?.total||0),review:list.filter(article=>article.status==='review').length,inputTokens:Number(usage[0]?.input_tokens||0),outputTokens:Number(usage[0]?.output_tokens||0),estimatedCostUsd:Number(usage[0]?.cost||0),pageViews:Number(views[0]?.total||0)}};
}
async function traceModeration(id:string,action:'approve'|'reject'|'withdraw'|'correct',article:Article,reason:string){
  const {logAction}=await import('./audit');
  const rows=await query('SELECT id,state FROM newsroom_jobs WHERE event_id=? ORDER BY updated_at DESC LIMIT 1',[id]);
  const job=rows[0];const now=new Date().toISOString();
  if(job){
    const state=action==='approve'?'PUBLISHED':action==='reject'?'REJECTED':action==='withdraw'?'RETRACTED':'UPDATED';
    if(action==='approve')await logAction('verifier','job-transition',String(job.id),{from:job.state,to:'APPROVED',actor:'administrator',reason});
    await execute('UPDATE newsroom_jobs SET state=?,draft_payload=?,verification_payload=?,updated_at=? WHERE id=?',[state,JSON.stringify(article),article.verification?JSON.stringify(article.verification):null,now,job.id]);
    if(article.verification)await execute('UPDATE newsroom_verifications SET payload=?,checked_at=? WHERE job_id=?',[JSON.stringify(article.verification),now,job.id]);
    await logAction('updater','job-transition',String(job.id),{from:action==='approve'?'APPROVED':job.state,to:state,actor:'administrator',reason});
    if(action==='approve'||action==='reject')await execute('UPDATE newsroom_jobs SET state=?,updated_at=? WHERE event_id=? AND state=? AND id<>?',['REJECTED',now,id,'REVIEW_REQUIRED',job.id]);
  }
  await logAction(action==='approve'?'verifier':'updater',`editorial-${action}`,id,{actor:'administrator',reason,status:article.status});
}
export async function moderateArticle(id:string,action:'approve'|'reject'|'withdraw'|'correct',data?:{title?:string;summary?:string;reason?:string;verified?:boolean}):Promise<void>{await transaction(async()=>{
  const rows=await query('SELECT payload FROM events WHERE id=?',[id]);if(!rows[0])throw new Error('Notizia non trovata');
  const previous=payload<Article>(rows[0]);const now=new Date().toISOString();
  const pending=await query('SELECT candidate FROM editorial_reviews WHERE event_id=? AND status=? ORDER BY created_at DESC LIMIT 1',[id,'pending']);
  if(action==='approve'&&previous.status!=='review'&&!pending.length)throw new Error('Nessuna versione in attesa di approvazione.');
  if(action==='reject'){
    await execute('UPDATE editorial_reviews SET status=? WHERE event_id=? AND status=?',['rejected',id,'pending']);
    if(previous.status==='published'){await traceModeration(id,action,previous,data?.reason||'Bozza respinta; la versione pubblica precedente rimane disponibile.');return;}
  }
  const article=action==='approve'&&pending[0]?JSON.parse(String(pending[0].candidate)) as Article:{...previous};
  if(action==='correct'||action==='approve'){
    if(action==='correct'&&!data?.reason?.trim())throw new Error('Una correzione richiede una motivazione pubblica');
    if(data?.title?.trim())article.title=data.title.trim().slice(0,400);
    if(data?.summary?.trim())article.summary=data.summary.trim().slice(0,4000);
  }
  if(action==='withdraw'&&!data?.reason?.trim())throw new Error('Il ritiro richiede una motivazione');
  article.status=action==='approve'?'published':action==='reject'?'rejected':action==='withdraw'?'withdrawn':previous.status;
  if(action==='approve'){
    const sources=new Map((await getSources()).map(source=>[source.id,source]));
    if(!article.citations.length||article.citations.some(citation=>!sources.get(citation.sourceId)?.authorized))throw new Error('L’approvazione richiede fonti effettive con diritti documentati.');
  }
  if(action==='approve'||action==='correct')recordHumanVerification(article,data?.verified===true,now);
  const {prepareSeo}=await import('./seo');article.seo=prepareSeo(article);
  const publicChange=previous.status==='published'&&action==='approve'&&(['title','summary','context','confirmed','unconfirmed'] as const).some(field=>JSON.stringify(previous[field])!==JSON.stringify(article[field]));
  article.updatedAt=now;if(action==='approve'){article.reviewReasons=[];if(previous.status!=='published')article.publishedAt=now;}
  article.timeline=[...article.timeline,{at:now,text:action==='correct'?`Correzione: ${data!.reason!.trim()}`:action==='withdraw'?`Ritiro: ${data!.reason!.trim()}`:action==='approve'?'Approvazione editoriale':'Esito della revisione: non pubblicata'}];
  await execute('INSERT INTO article_versions (id,event_id,payload,reason,created_at) VALUES (?,?,?,?,?)',[randomUUID(),id,JSON.stringify(previous),data?.reason||action,now]);
  await execute('UPDATE events SET title=?,status=?,payload=?,published_at=?,updated_at=? WHERE id=?',[article.title,article.status,JSON.stringify(article),article.publishedAt,now,id]);
  await execute('UPDATE editorial_reviews SET status=? WHERE event_id=? AND status=?',[action==='approve'?'approved':action==='reject'?'rejected':'superseded',id,'pending']);
  if(action==='correct'||action==='withdraw'||publicChange){
    const correction:Correction={id:randomUUID(),articleId:id,slug:article.slug,title:article.title,at:now,reason:data?.reason?.trim()||'Aggiornamento sostanziale approvato dalla redazione',previousTitle:previous.title,newTitle:article.title};
    await execute('INSERT INTO corrections (id,event_id,payload,created_at) VALUES (?,?,?,?)',[correction.id,id,JSON.stringify(correction),now]);
  }
  await traceModeration(id,action,article,data?.reason||'Decisione editoriale registrata.');
  if(action!=='reject'){const {reconcileBriefingsForArticle}=await import('./briefing');await reconcileBriefingsForArticle(id,data?.reason||'Aggiornamento editoriale dell’articolo collegato.');}
});const {rebuildHomepageEdition}=await import('./homepage');await rebuildHomepageEdition();}
export async function recordPageView():Promise<void>{if(process.env.ANALYTICS_ENABLED!=='true')return;await execute('INSERT INTO daily_metrics (day,page_views) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET page_views=daily_metrics.page_views+1',[romeDate()]);}
