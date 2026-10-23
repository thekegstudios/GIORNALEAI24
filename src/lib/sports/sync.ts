import { execute,query,transaction } from '../db';
import { apiSportsBase,normalizeApiSportsEvent,normalizeStandings,parseProviderEnvelope } from './adapter';
import { adjacentDate,romeSportsDate,sportsConfigured } from './catalog';
import { competitionAuthorized,getCompetitions,getDisciplines,getProviders,initializeSports,saveSportsBatch,sportsAudit } from './store';
import type { Competition,SportsProvider } from './types';
export function effectiveDailyLimit(provider:SportsProvider){const configured=Number(process.env.APISPORTS_DAILY_CAP||100);const cap=Number.isInteger(configured)&&configured>0?configured:100;return Math.min(provider.dailyLimit,cap,process.env.SPORTS_PAID_PLAN_AUTHORIZED==='true'?150000:100);}
export function adaptiveIntervalSeconds({live,imminent,finished,dailyLimit,competitions}: {live:boolean;imminent:boolean;finished:boolean;dailyLimit:number;competitions:number}){const desired=live?60:imminent?900:finished?3600:21600;const fairShare=Math.ceil(86400*Math.max(1,competitions)*4/Math.max(1,dailyLimit));return Math.max(desired,fairShare);}
export async function reserveSportsRequest(provider:SportsProvider,now=new Date()){
  return transaction(async()=>{
    const day=now.toISOString().slice(0,10),minute=now.toISOString().slice(0,16),id=`${provider.id}:${day}`;await execute('INSERT INTO sports_usage(id,provider_id,day,requests,minute_key,minute_requests,updated_at) VALUES(?,?,?,0,?,0,?) ON CONFLICT(id) DO NOTHING',[id,provider.id,day,minute,now.toISOString()]);await execute('UPDATE sports_usage SET requests=requests WHERE id=?',[id]);
    const row=(await query('SELECT * FROM sports_usage WHERE id=?',[id]))[0];const fresh=(await getProviders()).find(p=>p.id===provider.id);if(!fresh?.enabled)throw new Error('Provider disabilitato.');if(Number(row.requests)>=effectiveDailyLimit(fresh)||row.provider_remaining!==null&&Number(row.provider_remaining)<=0)throw new Error('Quota giornaliera esaurita.');const minuteCount=row.minute_key===minute?Number(row.minute_requests):0;if(minuteCount>=fresh.minuteLimit)throw new Error('Limite richieste per minuto raggiunto.');await execute('UPDATE sports_usage SET requests=requests+1,minute_key=?,minute_requests=?,updated_at=?,estimated_cost_usd=?,provider_remaining=CASE WHEN provider_remaining IS NULL THEN NULL ELSE provider_remaining-1 END WHERE id=?',[minute,minuteCount+1,now.toISOString(),fresh.monthlyCostUsd===0?0:null,id]);return id;
  });
}
async function providerFetch(competition:Competition,provider:SportsProvider,path:string,parameters:Record<string,string>){
  if(!sportsConfigured())throw new Error('Servizio sportivo non configurato.');const usageId=await reserveSportsRequest(provider);const url=new URL(path,apiSportsBase(competition.sportId));for(const [key,value]of Object.entries(parameters))url.searchParams.set(key,value);
  const response=await fetch(url,{headers:{'x-apisports-key':process.env.APISPORTS_KEY!,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  const remaining=response.headers.get('x-ratelimit-requests-remaining');if(remaining!==null&&/^\d+$/.test(remaining))await execute('UPDATE sports_usage SET provider_remaining=CASE WHEN provider_remaining IS NULL OR provider_remaining>? THEN ? ELSE provider_remaining END WHERE id=?',[Number(remaining),Number(remaining),usageId]);
  if(!response.ok)throw new Error(`Provider HTTP ${response.status}${response.status===429?': limite raggiunto':''}.`);
  const reader=response.body?.getReader();if(!reader)throw new Error('Risposta vuota.');const chunks:Uint8Array[]=[];let size=0;try{while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>4_000_000){await reader.cancel();throw new Error('Risposta provider troppo grande.');}chunks.push(result.value);}}finally{reader.releaseLock();}return parseProviderEnvelope(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function claimSportsTask(id:string,now=new Date()) {return transaction(async()=>{await execute('INSERT INTO sports_sync_state(id,next_at,locked_until,failures,payload) VALUES(?,?,NULL,0,?) ON CONFLICT(id) DO NOTHING',[id,now.toISOString(),'{}']);const result=await execute('UPDATE sports_sync_state SET locked_until=? WHERE id=? AND next_at<=? AND (locked_until IS NULL OR locked_until<=?)',[new Date(now.getTime()+90000).toISOString(),id,now.toISOString(),now.toISOString()]);return result.changes===1;});}
export async function runSportsCycle(){await initializeSports();if(!sportsConfigured())return {status:'unconfigured',imported:0,requests:0};const provider=(await getProviders()).find(p=>p.id==='api-sports');if(!provider?.enabled)return {status:'disabled',imported:0,requests:0};const enabled=new Set((await getDisciplines()).filter(s=>s.enabled).map(s=>s.id));const competitions=(await getCompetitions()).filter(c=>competitionAuthorized(c)&&enabled.has(c.sportId)&&['calcio','pallavolo'].includes(c.sportId));const today=romeSportsDate();let imported=0,requests=0;
  for(const competition of competitions){
    for(const task of [{kind:'events',date:today},{kind:'events',date:adjacentDate(today,1)},{kind:'events',date:adjacentDate(today,-1)},{kind:'standings',date:today}]){
      const key=`${competition.id}:${task.kind}:${task.date}`;if(!await claimSportsTask(key))continue;const now=new Date();
      try{
        const current=(await getCompetitions()).find(c=>c.id===competition.id);if(!current||!competitionAuthorized(current))throw new Error('Competizione disabilitata.');
        const parameters={league:competition.externalId,season:competition.season,...(task.kind==='events'?{date:task.date,timezone:'Europe/Rome'}:{})};requests++;
        const response=await providerFetch(competition,provider,task.kind==='standings'?'/standings':competition.sportId==='calcio'?'/fixtures':'/games',parameters);
        if(task.kind==='standings'){
          const standings=normalizeStandings(response,competition);await saveSportsBatch(competition,[],standings);
          await execute('UPDATE sports_sync_state SET next_at=?,locked_until=NULL,failures=0,last_success=?,last_error=NULL WHERE id=?',[new Date(Date.now()+86400000).toISOString(),now.toISOString(),key]);
        }else{
          const events=response.map(raw=>normalizeApiSportsEvent(raw,competition)).filter(e=>e!==null);imported+=await saveSportsBatch(competition,events);
          const seconds=adaptiveIntervalSeconds({live:events.some(e=>e.status==='live'),imminent:events.some(e=>e.status==='scheduled'&&Date.parse(e.startsAt)-now.getTime()<7200000&&Date.parse(e.startsAt)>now.getTime()),finished:events.length>0&&events.every(e=>e.status==='finished'),dailyLimit:effectiveDailyLimit(provider),competitions:competitions.length});
          await execute('UPDATE sports_sync_state SET next_at=?,locked_until=NULL,failures=0,last_success=?,last_error=NULL WHERE id=?',[new Date(Date.now()+seconds*1000).toISOString(),now.toISOString(),key]);
        }
      }catch(error){const message=error instanceof Error?error.message:'Sincronizzazione non riuscita.';const row=(await query('SELECT failures FROM sports_sync_state WHERE id=?',[key]))[0];const failures=Number(row?.failures||0)+1;let delay=Math.min(21600,60*2**Math.min(failures,8));if(/Quota giornaliera|HTTP 429/.test(message)){const midnight=new Date();midnight.setUTCHours(24,0,1,0);delay=Math.ceil((midnight.getTime()-Date.now())/1000);}await execute('UPDATE sports_sync_state SET next_at=?,locked_until=NULL,failures=?,last_error=? WHERE id=?',[new Date(Date.now()+delay*1000).toISOString(),failures,message.slice(0,300),key]);await sportsAudit('sync-error',competition.id,{task:task.kind,error:message.slice(0,300),retrySeconds:delay});}
    }
  }
  return {status:competitions.length?'completed':'no-authorized-competitions',imported,requests};
}
