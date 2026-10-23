import { randomUUID } from 'node:crypto';
import { execute, query, transaction } from './db';
import { DEFAULT_SETTINGS } from './catalog';
import type { Settings } from './types';
import type { BudgetOverview } from './newsroom-types';

export interface AIUsage { inputTokens:number; outputTokens:number; estimatedCostUsd:number }
export interface AIReservation { id:string; model:string; reservedUsd:number; inputPrice:number; outputPrice:number }
type Purpose='writer'|'chat'|'briefing';
const limit=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:fallback;
export function romeDate(value=new Date()):string{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
export function romeDayStart(value=new Date()):string{
  const day=romeDate(value);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',timeZoneName:'longOffset'}).formatToParts(new Date(`${day}T00:00:00Z`));
  const offset=(parts.find(part=>part.type==='timeZoneName')?.value||'GMT+01:00').replace('GMT','')||'+00:00';
  return new Date(`${day}T00:00:00${offset}`).toISOString();
}
export function aiPricing(model?:string):{input:number;output:number}|null{
  const configured=process.env.OPENAI_MODEL||'gpt-4.1-mini';
  if(!/^[a-zA-Z0-9._:-]{1,100}$/.test(configured)||(model&&model!==configured))return null;
  const input=Number(process.env.AI_INPUT_USD_PER_MILLION),output=Number(process.env.AI_OUTPUT_USD_PER_MILLION);
  return Number.isFinite(input)&&input>0&&Number.isFinite(output)&&output>0?{input,output}:null;
}
export function isAIConfigured(model?:string):boolean{return Boolean(process.env.OPENAI_API_KEY&&aiPricing(model));}
async function settings():Promise<Settings>{
  const rows=await query('SELECT payload FROM settings WHERE id=?',['global']);
  return {...DEFAULT_SETTINGS,...(rows[0]?JSON.parse(String(rows[0].payload)): {})};
}
async function overview(current:Settings,now=new Date()):Promise<BudgetOverview>{
  const day=romeDate(now),month=day.slice(0,7);
  const rows=await query(`SELECT u.day,u.input_tokens,u.output_tokens,u.reserved_usd,u.actual_usd,u.status,d.purpose,d.web_searches
    FROM ai_usage u LEFT JOIN ai_usage_details d ON d.usage_id=u.id WHERE u.day LIKE ?`,[`${month}-%`]);
  let spentTodayUsd=0,spentMonthUsd=0,inputTokens=0,outputTokens=0,callsToday=0,chatSpentTodayUsd=0,webSearches=0;
  for(const row of rows){
    const cost=Math.max(0,Number(row.status==='reserved'?row.reserved_usd:row.actual_usd)||0);
    spentMonthUsd+=cost;
    if(row.day!==day)continue;
    spentTodayUsd+=cost;callsToday++;inputTokens+=Number(row.input_tokens)||0;outputTokens+=Number(row.output_tokens)||0;
    webSearches+=Number(row.web_searches)||0;
    if(row.purpose==='chat')chatSpentTodayUsd+=cost;
  }
  const dailyBudgetUsd=limit(current.dailyBudgetUsd),monthlyBudgetUsd=limit(current.monthlyBudgetUsd,10),chatDailyBudgetUsd=limit(current.chatDailyBudgetUsd);
  return {day,month,spentTodayUsd,spentMonthUsd,dailyBudgetUsd,monthlyBudgetUsd,remainingTodayUsd:Math.max(0,dailyBudgetUsd-spentTodayUsd),remainingMonthUsd:Math.max(0,monthlyBudgetUsd-spentMonthUsd),inputTokens,outputTokens,callsToday,callsMonth:rows.length,webSearches,chatSpentTodayUsd,chatDailyBudgetUsd,warning:(dailyBudgetUsd>0&&spentTodayUsd>=dailyBudgetUsd*0.8)||(monthlyBudgetUsd>0&&spentMonthUsd>=monthlyBudgetUsd*0.8)||(chatDailyBudgetUsd>0&&chatSpentTodayUsd>=chatDailyBudgetUsd*0.8)};
}
export async function getBudgetOverview():Promise<BudgetOverview>{return overview(await settings());}
export async function reserveAIUsage(options:{purpose:Purpose;model:string;runId:string;maximumInputTokens:number;maxOutputTokens:number;settings:Settings}):Promise<AIReservation|null>{
  const prices=aiPricing(options.model);
  if(!isAIConfigured(options.model)||!prices||options.settings.paused||options.settings.safetyMode)return null;
  if(!Number.isSafeInteger(options.maximumInputTokens)||options.maximumInputTokens<1||!Number.isSafeInteger(options.maxOutputTokens)||options.maxOutputTokens<1)return null;
  const reservedUsd=(options.maximumInputTokens*prices.input+options.maxOutputTokens*prices.output)/1_000_000;
  if(!Number.isFinite(reservedUsd)||reservedUsd<=0)return null;
  return transaction(async()=>{
    // The same row serializes writer/chat reservations on PostgreSQL as well as SQLite.
    await execute('UPDATE settings SET payload=payload WHERE id=?',['global']);
    const latest=await settings();
    if(latest.paused||latest.safetyMode||latest.aiModel!==options.model)return null;
    const current={...latest,dailyBudgetUsd:Math.min(limit(latest.dailyBudgetUsd),limit(options.settings.dailyBudgetUsd)),monthlyBudgetUsd:Math.min(limit(latest.monthlyBudgetUsd,10),limit(options.settings.monthlyBudgetUsd,10)),chatDailyBudgetUsd:Math.min(limit(latest.chatDailyBudgetUsd),limit(options.settings.chatDailyBudgetUsd))};
    if(options.purpose==='chat'&&(!latest.chatEnabled||!options.settings.chatEnabled||!current.chatDailyBudgetUsd))return null;
    const spent=await overview(current);
    if(reservedUsd>spent.remainingTodayUsd+1e-12||reservedUsd>spent.remainingMonthUsd+1e-12)return null;
    if(options.purpose==='chat'&&reservedUsd+spent.chatSpentTodayUsd>spent.chatDailyBudgetUsd+1e-12)return null;
    const id=randomUUID(),now=new Date().toISOString();
    await execute('INSERT INTO ai_usage (id,run_id,day,input_tokens,output_tokens,reserved_usd,actual_usd,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,options.runId,romeDate(),0,0,reservedUsd,0,'reserved',now]);
    await execute('INSERT INTO ai_usage_details (usage_id,purpose,model,web_searches,created_at) VALUES (?,?,?,?,?)',[id,options.purpose,options.model,0,now]);
    return {id,model:options.model,reservedUsd,inputPrice:prices.input,outputPrice:prices.output};
  });
}
export function providerUsage(body:unknown,reservation:AIReservation):AIUsage|null{
  const data=body as {usage?:{input_tokens?:unknown;output_tokens?:unknown}};
  const input=data?.usage?.input_tokens,output=data?.usage?.output_tokens;
  if(typeof input!=='number'||typeof output!=='number'||!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)return null;
  return {inputTokens:input,outputTokens:output,estimatedCostUsd:(input*reservation.inputPrice+output*reservation.outputPrice)/1_000_000};
}
export async function settleAIUsage(reservation:AIReservation,usage:AIUsage|null,status:'completed'|'failed'):Promise<AIUsage>{
  const result=usage||{inputTokens:0,outputTokens:0,estimatedCostUsd:reservation.reservedUsd};
  // An uncertain timeout is charged at the reserved upper estimate; token counts remain unknown (zero).
  await execute('UPDATE ai_usage SET input_tokens=?,output_tokens=?,actual_usd=?,status=? WHERE id=? AND status=?',[result.inputTokens,result.outputTokens,result.estimatedCostUsd,status,reservation.id,'reserved']);
  return result;
}
