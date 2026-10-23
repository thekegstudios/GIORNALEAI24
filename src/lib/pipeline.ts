import { createHash, randomUUID } from 'node:crypto';
import { execute, query, transaction } from './db';
import { fetchFeed, type FeedItem } from './feeds';
import { generateSummary, isAIConfigured, romeDate } from './ai';
import { classifyCategories, evaluateEditorial, sameEvent, sensitiveReasons, slugify, sourceDateReasons } from './editorial';
import { getSettings, getSources } from './store';
import { logAction } from './audit';
import { claimNextJob, enqueueItem, failJob, recoverExpiredJobs, renewJobLease, transitionJob, type StoredJob } from './queue';
import { verifyEvidence } from './verification';
import { prepareSeo } from './seo';
import { italyScopeReasons } from './italy-scope';
import type { Article, Citation, DailyDigest, RunResult, Source } from './types';
import type { VerificationReport } from './newsroom-types';

const LEASE_MS=360_000;
function parse<T>(value:unknown):T{return JSON.parse(String(value)) as T;}
export async function acquirePipelineLock(owner:string,now=new Date()):Promise<boolean>{
  const rows=await query('INSERT INTO pipeline_locks (id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE pipeline_locks.expires_at<=? RETURNING owner',['ingestion',owner,new Date(now.getTime()+LEASE_MS).toISOString(),now.toISOString()]);
  return rows[0]?.owner===owner;
}
async function renewLock(owner:string):Promise<void>{const now=new Date();const rows=await query('UPDATE pipeline_locks SET expires_at=? WHERE id=? AND owner=? AND expires_at>? RETURNING owner',[new Date(now.getTime()+LEASE_MS).toISOString(),'ingestion',owner,now.toISOString()]);if(rows[0]?.owner!==owner)throw new Error('Lease del processo scaduta; pubblicazione interrotta');}
export async function releasePipelineLock(owner:string):Promise<void>{await execute('DELETE FROM pipeline_locks WHERE id=? AND owner=?',['ingestion',owner]);}
function citation(source:Source,item:FeedItem,now:string):Citation{return {sourceId:source.id,sourceName:source.name,url:item.url,title:item.title,publishedAt:item.publishedAt,checkedAt:now,license:item.rightsNotice||source.license,termsUrl:source.termsUrl};}
async function saveRun(run:RunResult){await execute('INSERT INTO pipeline_runs (id,payload,started_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[run.id,JSON.stringify(run),run.startedAt]);}
async function recordSourceCheck(source:Source,error:string|null,runId:string):Promise<void>{return transaction(async()=>{
  await execute('UPDATE sources SET payload=payload WHERE id=?',[source.id]);
  const rows=await query('SELECT payload FROM sources WHERE id=?',[source.id]);const current=rows[0]?parse<Source>(rows[0].payload):source;
  const now=new Date().toISOString();const health=await query('SELECT failures,suspended_until FROM source_health WHERE source_id=?',[source.id]);
  const failures=error?Number(health[0]?.failures||0)+1:0;const suspendedUntil=error&&failures>=3?new Date(Date.now()+15*60_000).toISOString():null;
  await execute('INSERT INTO source_health (source_id,failures,suspended_until,last_error,last_checked_at) VALUES (?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET failures=excluded.failures,suspended_until=excluded.suspended_until,last_error=excluded.last_error,last_checked_at=excluded.last_checked_at',[source.id,failures,suspendedUntil,error,now]);
  await execute('UPDATE sources SET payload=? WHERE id=?',[JSON.stringify({...current,lastCheckedAt:now,lastSuccessAt:error?current.lastSuccessAt:now,lastError:error}),source.id]);
  await logAction('researcher',error?'source-check-failed':'source-check-completed',source.id,{failures,error,suspendedUntil},runId);
  if(suspendedUntil)await logAction('supervisor','source-circuit-opened',source.id,{failures,suspendedUntil,note:'Sospensione temporanea di 15 minuti; la fonte resta abilitata.'},runId);
  if(!error&&Number(health[0]?.failures||0)>0)await logAction('supervisor','source-circuit-recovered',source.id,{previousFailures:Number(health[0].failures)},runId);
});}
async function existingArticle(item:FeedItem):Promise<{article:Article|null;itemId:string}>{
  const imported=await query('SELECT id FROM ingested_items WHERE source_id=? AND canonical_url=?',[item.sourceId,item.url]);if(!imported[0])throw new Error('Elemento della coda privo di registrazione di provenienza');
  const itemId=String(imported[0].id);const linked=await query('SELECT e.payload FROM events e JOIN citations c ON c.event_id=e.id WHERE c.item_id=? LIMIT 1',[itemId]);if(linked[0])return {article:parse<Article>(linked[0].payload),itemId};
  const candidates=await query('SELECT payload FROM events WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 200',[new Date(Date.now()-7*86400000).toISOString()]);
  const article=candidates.map(row=>parse<Article>(row.payload)).find(candidate=>sameEvent(candidate.title,item.title)&&!candidate.citations.some(entry=>entry.sourceId===item.sourceId)&&Boolean(item.publishedAt)&&candidate.citations.some(entry=>entry.publishedAt?.slice(0,10)===item.publishedAt?.slice(0,10)))||null;return {article,itemId};
}
function metadataDraft(source:Source,item:FeedItem,existing:Article|null,verification:VerificationReport):Article{
  const now=new Date().toISOString(),geography=verification.geography;
  return {id:existing?.id||randomUUID(),slug:existing?.slug||`${slugify(item.title)}-${createHash('sha256').update(`${source.id}:${item.url}`).digest('hex').slice(0,8)}`,title:existing&&existing.citations.length>1?existing.title:item.title,summary:'Metadati del feed ufficiale. Consulta la fonte originale per il contenuto completo.',context:'Questa scheda riporta titolo, collegamento e data dichiarata dalla fonte. Non contiene verifiche indipendenti o una sintesi AI.',categories:classifyCategories(item.title,source.id==='ispra'?'ambiente':''),region:geography.region,province:geography.province,municipality:geography.municipality,locationEvidence:geography.evidence,relevance:source.official?55:35,status:'review',publishedAt:existing?.publishedAt||item.publishedAt||now,updatedAt:now,confirmed:[],unconfirmed:[],explanations:{simple:'Spiegazione non disponibile: apri il documento originale indicato nelle fonti.',detailed:'Nessun approfondimento memorizzato per questa scheda.',causes:'Le cause non sono state elaborate.',consequences:'Le conseguenze non sono state elaborate.',practical:'Consulta la fonte ufficiale per destinatari, date di applicazione e istruzioni confermate.'},citations:[...(existing?.citations||[]).filter(entry=>entry.url!==item.url),citation(source,item,now)],timeline:[...(existing?.timeline||[]),{at:now,text:existing?'Aggiornamento acquisito dalla fonte; data dell’evento non determinata':'Prima acquisizione dal feed; data della fonte distinta dalla scoperta'}],reviewReasons:[],aiGenerated:false,originalContent:false,verification};
}
async function processJob(job:StoredJob,run:RunResult):Promise<'published'|'review'|'duplicate'>{
  const settings=await getSettings();if(settings.paused)throw new Error('Redazione sospesa durante l’elaborazione');
  const source=(await getSources()).find(entry=>entry.id===job.source.id);if(!source?.authorized||!source.enabled||!source.feedUrl)throw new Error('La fonte del job non è più abilitata e autorizzata');
  const item=job.item;await renewLock(run.id);await renewJobLease(job.id,run.id);
  if(job.state==='DISCOVERED')await transitionJob(job.id,run.id,'NORMALIZED',{runId:run.id});
  if(['DISCOVERED','NORMALIZED'].includes(job.state))await transitionJob(job.id,run.id,'VERIFYING',{runId:run.id});
  const {article:existing,itemId}=await existingArticle(item);let verification=await verifyEvidence(source,item);let article=job.draft||metadataDraft(source,item,existing,verification);
  if(existing){article.id=existing.id;article.slug=existing.slug;article.publishedAt=existing.publishedAt;}
  let aiProvenance:unknown=null,aiSensitive=article.reviewReasons.includes('Il modello segnala informazioni sensibili o divergenti');
  const preGate=[...sourceDateReasons(item.publishedAt),...sensitiveReasons(item.title,item.text),...italyScopeReasons(item.title,item.text)];
  const generatedAlready=existing?(await query('SELECT id FROM generated_summaries WHERE event_id=? AND input_hash=? LIMIT 1',[existing.id,item.hash])).length>0:false;
  const aiEligible=!settings.safetyMode&&source.allowSummary&&Boolean(item.text)&&isAIConfigured(settings.aiModel)&&preGate.length===0;
  if(!job.draft&&aiEligible&&!generatedAlready){
    try{
      // ingested_items is the latest discovery cursor for an URL. A newer
      // discovery can already be there while its job is still waiting, so it
      // must not silently replace the evidence of an older article.
      const previousEvidence=existing?(await query('SELECT item_payload FROM newsroom_jobs WHERE event_id=? AND source_id<>? AND draft_payload IS NOT NULL ORDER BY updated_at DESC LIMIT 20',[existing.id,item.sourceId])).map(row=>parse<FeedItem>(row.item_payload)).filter((entry,index,all)=>existing.citations.some(reference=>reference.sourceId===entry.sourceId&&reference.url===entry.url&&reference.title===entry.title&&reference.publishedAt===entry.publishedAt)&&all.findIndex(other=>other.hash===entry.hash)===index).slice(0,5):[];
      const generated=await generateSummary([...previousEvidence,item],settings,run.id);
      if(generated){const result=generated.result;aiProvenance={model:settings.aiModel,result,evidenceIds:[...previousEvidence,item].map(entry=>entry.hash)};article.summary=result.summary.text;article.context=result.context.text;article.categories=result.categories;article.relevance=result.relevance;article.confirmed=result.confirmed.map(claim=>claim.text);article.unconfirmed=result.unconfirmed.map(claim=>claim.text);article.explanations=Object.fromEntries(Object.entries(result.explanations).map(([key,value])=>[key,value.text])) as Article['explanations'];article.aiGenerated=true;article.originalContent=true;aiSensitive=result.sensitive||result.contradictions;}
    }catch(error){throw new Error(`${source.name}: elaborazione AI fallita (${error instanceof Error?error.message:'errore'})`);}
  }
  verification=await verifyEvidence(source,item,article);article.verification=verification;
  if(aiSensitive&&!article.reviewReasons.includes('Il modello segnala informazioni sensibili o divergenti'))article.reviewReasons.push('Il modello segnala informazioni sensibili o divergenti');
  const now=new Date().toISOString();article.updatedAt=now;
  // Keep the paid result and its provenance together before checking mutable
  // publication controls. A pause, lease loss or interrupted commit can retry
  // this checkpoint without another provider call.
  await transaction(async()=>{
    if(job.state!=='APPROVED')await transitionJob(job.id,run.id,'DRAFT',{eventId:article.id,draft:article,verification,runId:run.id});
    if(aiProvenance)await execute('INSERT INTO generated_summaries (id,event_id,input_hash,payload,created_at) VALUES (?,?,?,?,?)',[randomUUID(),article.id,item.hash,JSON.stringify(aiProvenance),now]);
  });
  await logAction('classifier','categories-and-geography-assigned',job.id,{categories:article.categories,geography:verification.geography},run.id);
  await transaction(async()=>{
    await renewLock(run.id);await renewJobLease(job.id,run.id);
    // These no-op writes lock the same rows used by the admin controls on both
    // SQLite and PostgreSQL; controls cannot change between this gate and commit.
    await execute('UPDATE settings SET payload=payload WHERE id=?',['global']);
    await execute('UPDATE sources SET payload=payload WHERE id=?',[source.id]);
    const liveSettings=await getSettings();
    if(liveSettings.paused)throw new Error('Redazione sospesa prima della pubblicazione');
    const sourceRows=await query('SELECT payload FROM sources WHERE id=?',[source.id]);
    const liveSource=sourceRows[0]?parse<Source>(sourceRows[0].payload):null;
    if(!liveSource?.authorized||!liveSource.enabled||!liveSource.feedUrl)throw new Error('La fonte è stata disabilitata prima della pubblicazione');
    verification=await verifyEvidence(liveSource,item,article);article.verification=verification;
    const evidenceValid=verification.checks.filter(check=>['rights-and-provenance','original-link','source-publication-date'].includes(check.name)).every(check=>check.passed);
    article.reviewReasons=[...evaluateEditorial({...article,context:`${article.context} ${item.text}`},{autoPublish:liveSettings.autoPublish,authorized:liveSource.authorized,evidenceValid}),...sourceDateReasons(item.publishedAt),...italyScopeReasons(item.title,item.text)];
    if(liveSettings.safetyMode)article.reviewReasons.push('Modalità sicurezza: ogni nuova pubblicazione richiede revisione umana');
    if(article.aiGenerated&&!liveSource.allowSummary)article.reviewReasons.push('La fonte non consente più elaborazioni AI: occorre una nuova verifica dei diritti');
    if(aiSensitive)article.reviewReasons.push('Il modello segnala informazioni sensibili o divergenti');
    if(article.aiGenerated&&verification.status!=='CONFIRMED')article.reviewReasons.push('Affermazioni AI attribuite ma non confermate da verifica semantica indipendente');
    if(source.id==='protezione-civile'&&article.categories.includes('meteo'))article.reviewReasons.push('Avviso di protezione civile: revisione prima della pubblicazione');
    if(existing?.status==='withdrawn'||existing?.status==='rejected')article.reviewReasons.push('Evento ritirato o respinto: è richiesta una nuova decisione editoriale');
    if(existing?.status==='published'&&existing.aiGenerated&&!article.aiGenerated)article.reviewReasons.push('Aggiornamento disponibile soltanto come metadati: conservata la versione editoriale pubblicata');
    article.reviewReasons=[...new Set(article.reviewReasons)];article.status=article.reviewReasons.length?'review':'published';
    if(existing)await execute('UPDATE events SET payload=payload WHERE id=?',[existing.id]);
    const currentRows=await query('SELECT payload FROM events WHERE id=?',[article.id]);const current=currentRows[0]?parse<Article>(currentRows[0].payload):null;
    if(current?.status==='withdrawn'||current?.status==='rejected'||(current&&current.updatedAt!==(existing?.updatedAt||article.updatedAt))){article.status='review';article.reviewReasons.push('La scheda è cambiata durante il job: richiesta revisione della nuova versione');}
    article.seo=prepareSeo(article);
    if(current)await execute('INSERT INTO article_versions (id,event_id,payload,reason,created_at) VALUES (?,?,?,?,?)',[randomUUID(),article.id,JSON.stringify(current),'Nuovo elemento della coda redazionale',now]);
    if(current?.status==='published'&&article.status==='review'){
      await execute('UPDATE editorial_reviews SET status=? WHERE event_id=? AND status=?',['superseded',article.id,'pending']);await execute('INSERT INTO editorial_reviews (id,event_id,candidate,reasons,status,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),article.id,JSON.stringify(article),JSON.stringify(article.reviewReasons),'pending',now]);
    }else{
      await execute('INSERT INTO events (id,slug,title,status,payload,published_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at',[article.id,article.slug,article.title,article.status,JSON.stringify(article),article.publishedAt,now]);
      if(article.status==='review'){await execute('UPDATE editorial_reviews SET status=? WHERE event_id=? AND status=?',['superseded',article.id,'pending']);await execute('INSERT INTO editorial_reviews (id,event_id,candidate,reasons,status,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),article.id,JSON.stringify(article),JSON.stringify(article.reviewReasons),'pending',now]);}
    }
    await execute('INSERT INTO citations (id,event_id,item_id,payload) VALUES (?,?,?,?) ON CONFLICT(event_id,item_id) DO UPDATE SET payload=excluded.payload',[randomUUID(),article.id,itemId,JSON.stringify(citation(source,item,now))]);
    if(article.status==='published'){
      if(job.state!=='APPROVED')await transitionJob(job.id,run.id,'APPROVED',{eventId:article.id,draft:article,verification,runId:run.id});
      await transitionJob(job.id,run.id,current?.status==='published'?'UPDATED':'PUBLISHED',{eventId:article.id,draft:article,verification,runId:run.id});
    }else await transitionJob(job.id,run.id,'REVIEW_REQUIRED',{eventId:article.id,draft:article,verification,runId:run.id});
    await logAction(current?.status==='published'?'updater':'writer',article.status==='published'?(current?'article-updated':'article-published'):'article-review-required',article.id,{jobId:job.id,sourceId:source.id,reasons:article.reviewReasons,verificationStatus:verification.status},run.id);
  });return article.status==='published'?'published':'review';
}
export async function runIngestion({force=false,reprocess=false}:{force?:boolean;reprocess?:boolean}={}):Promise<RunResult>{
  const run:RunResult={id:randomUUID(),startedAt:new Date().toISOString(),finishedAt:null,status:'running',imported:0,published:0,review:0,duplicates:0,errors:[],inputTokens:0,outputTokens:0,estimatedCostUsd:0};const settings=await getSettings();
  if(settings.paused)return {...run,status:'skipped',finishedAt:new Date().toISOString(),errors:['Automazione in pausa']};
  if(!await acquirePipelineLock(run.id))return {...run,status:'skipped',finishedAt:new Date().toISOString(),errors:['Un aggiornamento è già in esecuzione']};
  try{
    const previous=(await query('SELECT payload FROM pipeline_runs ORDER BY started_at DESC LIMIT 30')).map(row=>parse<RunResult>(row.payload)).find(item=>item.status==='completed'||item.status==='partial');
    if(!force&&previous&&Date.now()-new Date(previous.startedAt).getTime()<settings.intervalMinutes*60_000)return {...run,status:'skipped',finishedAt:new Date().toISOString(),errors:['Intervallo minimo non ancora trascorso']};
    await saveRun(run);await recoverExpiredJobs(run.id);await logAction('supervisor','run-started',run.id,{force,reprocess,safetyMode:Boolean(settings.safetyMode)},run.id);
    const sources=(await getSources()).filter(source=>source.enabled&&source.authorized&&source.feedUrl);
    for(const source of sources){
      await renewLock(run.id);const health=await query('SELECT suspended_until FROM source_health WHERE source_id=?',[source.id]);if(health[0]?.suspended_until&&String(health[0].suspended_until)>new Date().toISOString())continue;
      try{
        const items=await fetchFeed(source);
        for(const item of items){
          const queued=await enqueueItem(source,item,{runId:run.id});if(!queued.created)run.duplicates++;
          if(reprocess){const {article}=await existingArticle(item);const eligible=article&&!article.aiGenerated&&!['withdrawn','rejected'].includes(article.status)&&source.allowSummary&&item.text&&!settings.safetyMode&&isAIConfigured(settings.aiModel)&&!sourceDateReasons(item.publishedAt).length&&!sensitiveReasons(item.title,item.text).length;if(eligible&&!(await query('SELECT id FROM generated_summaries WHERE event_id=? AND input_hash=? LIMIT 1',[article.id,item.hash])).length)await enqueueItem(source,item,{reprocess:true,model:settings.aiModel,runId:run.id});}
        }await recordSourceCheck(source,null,run.id);
      }catch(error){const message=error instanceof Error?error.message:'Feed non raggiungibile';run.errors.push(`${source.name}: ${message}`);await recordSourceCheck(source,message,run.id);}
    }
    for(let processed=0;processed<settings.maxItemsPerRun;processed++){
      const currentSettings=await getSettings();if(currentSettings.paused)break;
      await renewLock(run.id);const job=await claimNextJob(run.id);if(!job)break;
      try{const outcome=await processJob(job,run);if(outcome==='duplicate')run.duplicates++;else{run.imported++;if(outcome==='published')run.published++;else run.review++;}}
      catch(error){run.errors.push(error instanceof Error?error.message:'Errore di elaborazione della coda');await failJob(job.id,run.id,error,run.id);}
    }
    await buildDailyDigest();run.status=run.errors.length?'partial':'completed';await logAction('supervisor','run-completed',run.id,{imported:run.imported,published:run.published,review:run.review,errors:run.errors.length},run.id);
  }catch(error){run.status='failed';run.errors.push(error instanceof Error?error.message:'Errore del processo');await logAction('supervisor','run-failed',run.id,{error:run.errors.at(-1)},run.id);}
  finally{
    run.finishedAt=new Date().toISOString();try{if(run.status!=='running'){const usage=await query('SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(CASE WHEN status=? THEN reserved_usd ELSE actual_usd END),0) AS cost FROM ai_usage WHERE run_id=?',['reserved',run.id]);run.inputTokens=Number(usage[0]?.input_tokens||0);run.outputTokens=Number(usage[0]?.output_tokens||0);run.estimatedCostUsd=Number(usage[0]?.cost||0);await saveRun(run);}}finally{await releasePipelineLock(run.id);}
  }return run;
}
export async function buildDailyDigest():Promise<void>{
  const date=romeDate(),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',hourCycle:'h23'}).format(new Date()));if(hour<6)return;if((await query('SELECT id FROM daily_digests WHERE id=?',[date])).length)return;
  const rows=await query('SELECT payload FROM events WHERE status=? AND published_at>=? ORDER BY published_at DESC LIMIT 200',['published',new Date(Date.now()-86400000).toISOString()]);const articles=rows.map(row=>parse<Article>(row.payload)).sort((a,b)=>b.relevance-a.relevance).slice(0,6);if(!articles.length)return;
  const digest:DailyDigest={date,generatedAt:new Date().toISOString(),items:articles.map(article=>({id:article.id,slug:article.slug,title:article.title,summary:article.summary}))};await execute('INSERT INTO daily_digests (id,payload) VALUES (?,?) ON CONFLICT(id) DO NOTHING',[date,JSON.stringify(digest)]);
}
export async function reprocessMetadata():Promise<RunResult>{return runIngestion({force:true,reprocess:true});}
