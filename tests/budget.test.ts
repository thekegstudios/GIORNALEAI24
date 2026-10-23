import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeDatabase, execute, initDatabase, query } from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/catalog';
import { getBudgetOverview, providerUsage, reserveAIUsage, romeDate, romeDayStart, settleAIUsage } from '../src/lib/budget';
import type { Settings } from '../src/lib/types';

process.env.DATABASE_PATH=':memory:';delete process.env.DATABASE_URL;
const envKeys=['OPENAI_API_KEY','OPENAI_MODEL','AI_INPUT_USD_PER_MILLION','AI_OUTPUT_USD_PER_MILLION'];
const saved=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
let settings:Settings;
beforeEach(async()=>{
  await closeDatabase();
  process.env.OPENAI_API_KEY='TEST-KEY-NEVER-SENT';process.env.OPENAI_MODEL='budget-test-model';
  process.env.AI_INPUT_USD_PER_MILLION='1';process.env.AI_OUTPUT_USD_PER_MILLION='1';
  await initDatabase();
  settings={...DEFAULT_SETTINGS,aiModel:'budget-test-model',paused:false,safetyMode:false,dailyBudgetUsd:1,monthlyBudgetUsd:10,chatDailyBudgetUsd:1,chatEnabled:true};
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(settings),'global']);
});
after(async()=>{await closeDatabase();for(const key of envKeys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
const reserve=(purpose:'writer'|'chat',input=20000,custom=settings)=>reserveAIUsage({purpose,model:custom.aiModel,runId:'TEST-FIXTURE-BUDGET',maximumInputTokens:input,maxOutputTokens:1,settings:custom});

test('writer and chat reserve against one atomic daily limit, without fabricated token or web counts',async()=>{
  settings={...settings,dailyBudgetUsd:0.1,monthlyBudgetUsd:0.1};
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(settings),'global']);
  const reservations=await Promise.all([reserve('writer',60000),reserve('chat',60000)]);
  assert.equal(reservations.filter(Boolean).length,1);
  const overview=await getBudgetOverview();
  assert.equal(overview.callsToday,1);assert.equal(overview.callsMonth,1);assert.equal(overview.webSearches,0);
  assert.equal(overview.inputTokens,0);assert.equal(overview.outputTokens,0);assert.ok(overview.spentTodayUsd>0.06);
  assert.equal((await query('SELECT model FROM ai_usage_details'))[0].model,'budget-test-model');
});
test('monthly usage blocks new calls even when today has available budget',async()=>{
  settings={...settings,dailyBudgetUsd:1,monthlyBudgetUsd:0.1};
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(settings),'global']);
  await execute('INSERT INTO ai_usage (id,run_id,day,input_tokens,output_tokens,reserved_usd,actual_usd,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',['past-call','TEST-FIXTURE',`${romeDate().slice(0,7)}-01`,10,10,0.09,0.09,'completed',new Date().toISOString()]);
  assert.equal(await reserve('writer',20000),null);
  assert.equal((await getBudgetOverview()).spentMonthUsd,0.09);
});
test('chat subbudget and latest safety/pause state block calls while archive remains independent',async()=>{
  settings={...settings,chatDailyBudgetUsd:0.01};
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify(settings),'global']);
  assert.equal(await reserve('chat'),null);assert.ok(await reserve('writer'));
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify({...settings,safetyMode:true}),'global']);
  assert.equal(await reserve('writer'),null);
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify({...settings,paused:true}),'global']);
  assert.equal(await reserve('writer'),null);
});
test('uncertain provider failure retains reserved cost with unknown token counts',async()=>{
  const reservation=await reserve('chat');assert.ok(reservation);
  await settleAIUsage(reservation,null,'failed');
  const overview=await getBudgetOverview();
  assert.equal(overview.spentTodayUsd,reservation.reservedUsd);assert.equal(overview.chatSpentTodayUsd,reservation.reservedUsd);
  assert.equal(overview.inputTokens,0);assert.equal(overview.outputTokens,0);assert.equal(overview.webSearches,0);
  assert.equal((await query('SELECT status FROM ai_usage'))[0].status,'failed');
});
test('successful usage records actual tokens and costs while missing prices or wrong model fail closed',async()=>{
  const reservation=await reserve('writer');assert.ok(reservation);
  await settleAIUsage(reservation,{inputTokens:100,outputTokens:20,estimatedCostUsd:0.00012},'completed');
  const overview=await getBudgetOverview();assert.equal(overview.inputTokens,100);assert.equal(overview.outputTokens,20);assert.equal(overview.spentTodayUsd,0.00012);
  assert.equal(await reserve('writer',100,{...settings,aiModel:'unpriced-model'}),null);
  process.env.AI_INPUT_USD_PER_MILLION='0';assert.equal(await reserve('writer'),null);
});
test('calendar grouping follows Rome across midnight and daylight saving changes',()=>{
  assert.equal(romeDate(new Date('2026-10-31T23:30:00Z')),'2026-11-01');
  assert.equal(romeDayStart(new Date('2026-10-25T12:00:00Z')),'2026-10-24T22:00:00.000Z');
  assert.equal(romeDayStart(new Date('2026-03-29T12:00:00Z')),'2026-03-28T23:00:00.000Z');
});

test('a model changed by the manager rejects a reservation made with stale settings',async()=>{
  await execute('UPDATE settings SET payload=? WHERE id=?',[JSON.stringify({...settings,aiModel:'another-model'}),'global']);
  assert.equal(await reserve('writer'),null);assert.equal(await reserve('chat'),null);
  assert.equal((await getBudgetOverview()).callsToday,0);
});

test('provider token counts remain unknown when omitted, null or nonnumeric',async()=>{
  const reservation=await reserve('writer');assert.ok(reservation);
  assert.equal(providerUsage({usage:{input_tokens:null,output_tokens:20}},reservation),null);
  assert.equal(providerUsage({usage:{input_tokens:'100',output_tokens:20}},reservation),null);
  assert.equal(providerUsage({usage:{input_tokens:100}},reservation),null);
  assert.equal(providerUsage({usage:{input_tokens:100,output_tokens:20}},reservation)?.estimatedCostUsd,0.00012);
});
