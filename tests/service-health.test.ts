import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
process.env.DATABASE_PATH = ':memory:';
process.env.OPENAI_API_KEY = '';
process.env.HEALTH_ALERT_WEBHOOK_URL = '';
process.env.HEALTHCHECK_PROBE_WEB = 'false';
process.env.FUEL_DATA_ENABLED = 'true';
process.env.ECONOMIC_DATA_ENABLED = 'true';
process.env.NETLIFY = '';
process.env.SCHEDULER_MODE = 'worker';
const directory = await mkdtemp(path.join(tmpdir(), 'ai24-watchdog-test-'));
process.env.WATCHDOG_STATE_DIR = directory;
const { query, execute, closeDatabase } = await import('../src/lib/db');
const { getSettings, updateSettings } = await import('../src/lib/store');
const { classifyImportHealth, classifyScheduledJobHealth, getServiceHealth, notifyHealthIncident, runWatchdogCycle, healthNotificationsConfigured, watchdogStateDirectory } = await import('../src/lib/service-health');
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await closeDatabase(); await unlink(path.join(directory, 'watchdog-alerts.json')).catch(() => undefined); await unlink(path.join(directory, 'watchdog-alerts.lock')).catch(() => undefined); await rmdir(directory); });
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
const incident = (name: string) => ({ fingerprint: fingerprint(name), component: 'Componente di prova', code: 'test-isolated', state: 'error' as const, message: 'Non inviare contenuti privati.', firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
async function putRuntime(id: string, payload: unknown) { const now = new Date().toISOString(); await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', [id, JSON.stringify(payload), now]); }

test('import monitoring distinguishes real failure, old successful imports and disabled services without replacing dataset dates', () => {
  const now = new Date(), old = new Date(now.getTime() - 5 * 86400_000).toISOString();
  assert.equal(classifyImportHealth('fuel', null, { now, staleHours: 36 }).code, 'never-imported');
  assert.equal(classifyImportHealth('fuel', { lastSuccessAt: old }, { now, staleHours: 36 }).code, 'stale-import');
  assert.equal(classifyImportHealth('fuel', { lastSuccessAt: old }, { now, staleHours: 36, enabled: false }).state, 'disabled');
  const failed = classifyImportHealth('fuel', { lastSuccessAt: now.toISOString(), lastError: 'HTTP https://provider.example/path?token=private-secret API_KEY=hidden', failures: 3 }, { now, staleHours: 36 });
  assert.equal(failed.state, 'warning'); assert.equal(failed.details.failures, 3); assert(!failed.message.includes('private-secret')); assert(!failed.message.includes('hidden'));
});
test('health inspection reads real missing heartbeat, budgets and data imports without calling providers or recording usage', async () => {
  await updateSettings({ paused: false, safetyMode: false });
  let requests = 0; globalThis.fetch = async () => { requests++; throw new Error('Read-only monitor must never call a provider.'); };
  const beforeUsage = Number((await query('SELECT COUNT(*) AS count FROM ai_usage'))[0].count), beforeAudit = Number((await query('SELECT COUNT(*) AS count FROM newsroom_actions'))[0].count);
  const result = await getServiceHealth(); assert.equal(result.checks.find(check => check.id === 'news-scheduler')?.state, 'error');
  assert.equal(result.checks.find(check => check.id === 'openai')?.state, 'disabled'); assert.equal(result.checks.find(check => check.id === 'sports')?.state, 'disabled');
  assert.equal(result.checks.find(check => check.id === 'istat-arera')?.state, 'unknown'); assert.equal(requests, 0);
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM ai_usage'))[0].count), beforeUsage);
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM newsroom_actions'))[0].count), beforeAudit);
});
test('HTTP scheduler uses actual source checks and an administrative pause is reported as suspension', async () => {
  const settings = await getSettings(); process.env.SCHEDULER_MODE = 'http';
  const row = (await query('SELECT payload FROM sources WHERE id=?', ['ispra']))[0], source = JSON.parse(String(row.payload));
  source.lastCheckedAt = new Date().toISOString(); source.lastError = null; await execute('UPDATE sources SET payload=? WHERE id=?', [JSON.stringify(source), 'ispra']);
  assert.equal((await getServiceHealth()).checks.find(check => check.id === 'news-scheduler')?.state, 'ok');
  await updateSettings({ paused: true }); const paused = await getServiceHealth(); assert.equal(paused.state, 'suspended'); assert.equal(paused.checks.find(check => check.id === 'news-scheduler')?.state, 'disabled');
  await updateSettings({ paused: settings.paused }); process.env.SCHEDULER_MODE = 'worker';
});
test('recent imports do not make old fuel datasets/statistical periods current and rejected rows remain visible', async () => {
  const now = new Date().toISOString(); await putRuntime('fuel', { lastCheckedAt: now, lastSuccessAt: now, lastError: null, datasetDate: '2020-01-01' }); await putRuntime('economy', { lastCheckedAt: now, lastSuccessAt: now, lastError: null });
  await execute('INSERT INTO fuel_imports (id,dataset_date,imported_at,station_count,price_count,input_hash,source_url) VALUES (?,?,?,?,?,?,?)', ['health-fuel', '2020-01-01', now, 100, 1000, 'test-only', 'https://www.mimit.gov.it']);
  await execute('INSERT INTO economic_indicators (id,series_id,period,published_at,payload) VALUES (?,?,?,?,?)', ['health-economy', 'test', '2020-01', now, '{}']);
  await execute('INSERT INTO newsroom_actions (id,module,action,entity_id,run_id,details,created_at) VALUES (?,?,?,?,?,?,?)', ['fuel-health-audit', 'researcher', 'fuel-snapshot-imported', null, null, JSON.stringify({ prices: 1000, rejected: 200 }), now]);
  const result = await getServiceHealth(); assert.equal(result.checks.find(check => check.id === 'fuel-dataset')?.state, 'warning'); assert.equal(result.checks.find(check => check.id === 'economic-period')?.state, 'warning'); assert.equal(result.checks.find(check => check.id === 'fuel-rejected')?.details.rejectedRows, 200);
  await updateSettings({ dailyBudgetUsd: 0 }); assert.equal((await getServiceHealth()).checks.find(check => check.id === 'ai-budget')?.code, 'cap-reached'); await updateSettings({ dailyBudgetUsd: 1 });
});

test('data-worker presence is checked separately from recent imports and accepts both recorded heartbeat fields', async () => {
  const now = new Date();
  await putRuntime('fuel', { lastCheckedAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastError: null });
  await putRuntime('data-worker', { state: 'online', heartbeatAt: new Date(now.getTime() - 4 * 60_000).toISOString() });
  assert.equal((await getServiceHealth({ now })).checks.find(check => check.id === 'data-worker')?.state, 'warning');
  await putRuntime('data-worker', { state: 'online', heartbeatAt: now.toISOString() });
  assert.equal((await getServiceHealth({ now })).checks.find(check => check.id === 'data-worker')?.state, 'ok');
  await putRuntime('data-worker', { state: 'stopped', lastHeartbeatAt: now.toISOString() });
  assert.equal((await getServiceHealth({ now })).checks.find(check => check.id === 'data-worker')?.state, 'warning');
  await putRuntime('data-worker', { state: 'online', lastHeartbeatAt: now.toISOString() });
  assert.equal((await getServiceHealth({ now })).checks.find(check => check.id === 'data-worker')?.state, 'ok');
  process.env.FUEL_DATA_ENABLED = 'false'; process.env.ECONOMIC_DATA_ENABLED = 'false';
  assert.equal((await getServiceHealth({ now })).checks.find(check => check.id === 'data-worker')?.state, 'disabled');
  process.env.FUEL_DATA_ENABLED = 'true'; process.env.ECONOMIC_DATA_ENABLED = 'true';
});

test('scheduled job health distinguishes completed, stale, failed and stalled jobs without exposing error payloads', () => {
  const now = new Date(), iso = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const options = { now, staleMinutes: 75 };
  assert.equal(classifyScheduledJobHealth('data', null, options).code, 'job-never-run');
  assert.equal(classifyScheduledJobHealth('data', { state: 'completed', startedAt: iso(71), finishedAt: iso(70) }, options).code, 'job-current');
  assert.equal(classifyScheduledJobHealth('data', { state: 'completed', finishedAt: iso(76) }, options).code, 'job-stale');
  assert.equal(classifyScheduledJobHealth('data', { state: 'completed', finishedAt: iso(-5) }, options).state, 'warning');
  assert.equal(classifyScheduledJobHealth('data', { state: 'running', startedAt: iso(1) }, options).code, 'job-running');
  assert.equal(classifyScheduledJobHealth('data', { state: 'running', startedAt: iso(15), lastHeartbeatAt: iso(0) }, options).code, 'job-stalled');
  assert.equal(classifyScheduledJobHealth('data', { state: 'failed', finishedAt: iso(0) }, options).code, 'job-failed');
  assert.equal(classifyScheduledJobHealth('data', { state: 'partial', finishedAt: iso(0) }, options).code, 'job-partial');
  assert.equal(classifyScheduledJobHealth('data', { state: 'completed' }, options).state, 'warning');
  assert.equal(classifyScheduledJobHealth('sports', null, { ...options, enabled: false }).state, 'disabled');
});

async function withNetlifyRuntime(work: (now: Date) => Promise<void>) {
  const previousMode = process.env.SCHEDULER_MODE, previousNetlify = process.env.NETLIFY, previousFetch = globalThis.fetch;
  process.env.NETLIFY = 'true'; process.env.SCHEDULER_MODE = 'http';
  globalThis.fetch = async () => { throw new Error('Scheduled health inspection must not contact a provider.'); };
  const now = new Date();
  try {
    await putRuntime('netlify-scheduler', { mode: 'scheduled', state: 'online', lastHeartbeatAt: now.toISOString(), newsIntervalMinutes: 5, dataIntervalMinutes: 60, sportsIntervalMinutes: 2, watchdogIntervalMinutes: 1 });
    for (const target of ['news', 'watchdog']) await putRuntime(`netlify-job:${target}`, { state: 'completed', startedAt: now.toISOString(), finishedAt: now.toISOString() });
    await putRuntime('watchdog', { state: 'online', lastHeartbeatAt: now.toISOString() });
    await work(now);
  } finally {
    await execute('DELETE FROM public_data_runtime WHERE id LIKE ?', ['netlify-%']);
    process.env.SCHEDULER_MODE = previousMode; process.env.NETLIFY = previousNetlify; globalThis.fetch = previousFetch;
  }
}

test('Netlify scheduled mode reports recent jobs separately from persistent data-worker heartbeats', async () => {
  await withNetlifyRuntime(async now => {
    const finishedAt = new Date(now.getTime() - 70 * 60_000).toISOString();
    await putRuntime('data-worker', { state: 'stopped', lastHeartbeatAt: '2020-01-01T00:00:00.000Z' });
    await putRuntime('netlify-job:data', { state: 'completed', startedAt: finishedAt, finishedAt });
    const snapshot = await getServiceHealth({ now }), data = snapshot.checks.find(value => value.id === 'data-worker');
    assert.equal(snapshot.checks.find(value => value.id === 'netlify-scheduler')?.state, 'ok');
    assert.equal(data?.state, 'ok'); assert.equal(data?.code, 'job-current'); assert.equal(data?.component, 'Job dati programmato'); assert.equal(data?.lastSuccessAt, finishedAt);
    assert(!data?.message.includes('Heartbeat del worker dati presente'));
    assert.equal(snapshot.checks.find(value => value.id === 'watchdog')?.code, 'scheduled-watchdog-current');
    assert.equal(snapshot.watchdog.online, true);
    assert.equal(snapshot.checks.find(value => value.id === 'netlify-job:sports')?.state, 'disabled');
  });
});

test('fresh Netlify scheduling cannot hide missing, stale or failed data jobs and long-running watchdog jobs', async () => {
  await withNetlifyRuntime(async now => {
    await execute('DELETE FROM public_data_runtime WHERE id=?', ['netlify-job:data']);
    await putRuntime('data-worker', { state: 'online', lastHeartbeatAt: now.toISOString() });
    assert.equal((await getServiceHealth({ now })).checks.find(value => value.id === 'data-worker')?.code, 'job-never-run');
    await putRuntime('netlify-job:data', { state: 'completed', finishedAt: new Date(now.getTime() - 76 * 60_000).toISOString() });
    assert.equal((await getServiceHealth({ now })).checks.find(value => value.id === 'data-worker')?.code, 'job-stale');
    await putRuntime('netlify-job:data', { state: 'failed', startedAt: now.toISOString(), finishedAt: now.toISOString(), error: 'token=private-scheduled-error' });
    const failed = await getServiceHealth({ now }); assert.equal(failed.checks.find(value => value.id === 'data-worker')?.code, 'job-failed'); assert(!JSON.stringify(failed).includes('private-scheduled-error'));
    await putRuntime('netlify-job:watchdog', { state: 'running', startedAt: new Date(now.getTime() - 15 * 60_000).toISOString(), lastHeartbeatAt: now.toISOString() });
    const stalled = await getServiceHealth({ now }); assert.equal(stalled.checks.find(value => value.id === 'watchdog')?.code, 'job-stalled'); assert.equal(stalled.watchdog.online, false);
  });
});

test('old or absent scheduled heartbeats remain unhealthy despite recent successful jobs and imports', async () => {
  await withNetlifyRuntime(async now => {
    await putRuntime('netlify-job:data', { state: 'completed', startedAt: now.toISOString(), finishedAt: now.toISOString() });
    await putRuntime('netlify-scheduler', { mode: 'scheduled', state: 'online', lastHeartbeatAt: new Date(now.getTime() - 4 * 60_000).toISOString() });
    let snapshot = await getServiceHealth({ now });
    assert.equal(snapshot.checks.find(value => value.id === 'netlify-scheduler')?.state, 'error'); assert.equal(snapshot.watchdog.online, false);
    assert.equal(snapshot.checks.find(value => value.id === 'data-worker')?.state, 'ok');
    await execute('DELETE FROM public_data_runtime WHERE id=?', ['netlify-scheduler']);
    snapshot = await getServiceHealth({ now }); assert.equal(snapshot.checks.find(value => value.id === 'netlify-scheduler')?.code, 'schedule-heartbeat-missing');
  });
});

test('Netlify fallback alert files use temporary storage while an explicit state directory is preserved', () => {
  const previousNetlify = process.env.NETLIFY, previousDirectory = process.env.WATCHDOG_STATE_DIR;
  try {
    process.env.NETLIFY = 'true'; delete process.env.WATCHDOG_STATE_DIR;
    assert.equal(watchdogStateDirectory(), path.join(tmpdir(), 'giornale-ai24-watchdog'));
    process.env.WATCHDOG_STATE_DIR = directory; assert.equal(watchdogStateDirectory(), directory);
  } finally { process.env.NETLIFY = previousNetlify; process.env.WATCHDOG_STATE_DIR = previousDirectory; }
});

test('a partial news execution remains a warning and no raw error enters health results', async () => {
  const now = new Date().toISOString();
  await execute('INSERT INTO pipeline_runs (id,payload,started_at) VALUES (?,?,?)', ['health-partial', JSON.stringify({ status: 'partial', finishedAt: now, errors: ['https://private.invalid/?token=must-remain-private'] }), now]);
  const result = await getServiceHealth(), run = result.checks.find(check => check.id === 'news-last-run');
  assert.equal(run?.state, 'warning'); assert.equal(run?.details.errors, 1);
  assert(!JSON.stringify(result).includes('must-remain-private'));
  await execute('DELETE FROM pipeline_runs WHERE id=?', ['health-partial']);
});

test('an AI reservation is not reported as a completed live request', async () => {
  const settings = await getSettings();
  process.env.OPENAI_API_KEY = 'test-only-key-never-sent'; process.env.OPENAI_MODEL = settings.aiModel;
  process.env.AI_INPUT_USD_PER_MILLION = '1'; process.env.AI_OUTPUT_USD_PER_MILLION = '1';
  const now = new Date().toISOString();
  await execute('INSERT INTO ai_usage (id,run_id,day,input_tokens,output_tokens,reserved_usd,actual_usd,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)', ['health-reserved', 'health-test', now.slice(0, 10), 0, 0, 0.01, 0, 'reserved', now]);
  const result = await getServiceHealth(), ai = result.checks.find(check => check.id === 'openai');
  assert.equal(ai?.state, 'unknown'); assert.equal(ai?.code, 'requests-pending'); assert.equal(ai?.lastSuccessAt, null);
  assert(!JSON.stringify(result).includes(process.env.OPENAI_API_KEY));
  await execute('UPDATE ai_usage SET status=? WHERE id=?', ['completed', 'health-reserved']);
  assert.equal((await getServiceHealth()).checks.find(check => check.id === 'openai')?.state, 'ok');
  await execute('DELETE FROM ai_usage WHERE id=?', ['health-reserved']); process.env.OPENAI_API_KEY = '';
});
test('unconfigured or non-HTTPS alert channels never send a notification or invent delivery', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Not permitted.'); };
  process.env.HEALTH_ALERT_WEBHOOK_URL = ''; assert.equal(await notifyHealthIncident(incident('unconfigured')), 'unconfigured');
  process.env.HEALTH_ALERT_WEBHOOK_URL = 'http://alerts.example.invalid/path'; assert.equal(healthNotificationsConfigured(), false); assert.equal(await notifyHealthIncident(incident('http')), 'unconfigured');
  process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://127.0.0.1/private'; assert.equal(healthNotificationsConfigured(), false); assert.equal(calls, 0);
});
test('durable alert claims deduplicate concurrent processes and webhook payloads exclude secret URLs and private messages', async () => {
  process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://alerts.example.invalid/secret-path?token=never-serialize'; let calls = 0;
  process.env.HEALTH_ALERT_WEBHOOK_SECRET = 'isolated-webhook-test-secret';
  globalThis.fetch = async (_input, init) => { calls++; const body = String(init?.body); assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer isolated-webhook-test-secret'); assert(!body.includes('secret-path')); assert(!body.includes('never-serialize')); assert(!body.includes('isolated-webhook-test-secret')); assert(!body.includes('Non inviare contenuti privati')); return new Response(null, { status: 204 }); };
  const event = incident('duplicate'); const result = await Promise.all([notifyHealthIncident(event), notifyHealthIncident(event)]);
  assert.equal(calls, 1); assert.equal(result.filter(value => value === 'sent').length, 1); assert.equal(await notifyHealthIncident(event), 'skipped');
  assert.equal((await query('SELECT status FROM admin_alerts WHERE fingerprint=?', [event.fingerprint]))[0].status, 'sent');
  assert(!(await query('SELECT details FROM newsroom_actions WHERE entity_id=?', [event.fingerprint])).some(row => String(row.details).includes('isolated-webhook-test-secret')));
  process.env.HEALTH_ALERT_WEBHOOK_SECRET = '';
});
test('notification failures back off and stop after three attempts until the configured cooldown', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return new Response('Provider failure', { status: 503 }); };
  const event = incident('retry-cap'), now = new Date();
  assert.equal(await notifyHealthIncident(event, now), 'failed'); assert.equal(await notifyHealthIncident(event, new Date(now.getTime() + 1000)), 'skipped');
  assert.equal(await notifyHealthIncident(event, new Date(now.getTime() + 31_000)), 'failed'); assert.equal(await notifyHealthIncident(event, new Date(now.getTime() + 95_000)), 'failed');
  assert.equal(await notifyHealthIncident(event, new Date(now.getTime() + 10 * 60_000)), 'skipped'); assert.equal(calls, 3);
});
test('notification fallback survives loss of the DB alert table and prevents a duplicate after DB recovery', async () => {
  await execute('DROP TABLE admin_alerts'); let calls = 0; globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
  const event = incident('db-fallback'); assert.equal(await notifyHealthIncident(event), 'sent');
  const saved = await readFile(path.join(directory, 'watchdog-alerts.json'), 'utf8'); assert(saved.includes(event.fingerprint)); assert(!saved.includes('never-serialize'));
  await execute('CREATE TABLE admin_alerts (fingerprint TEXT PRIMARY KEY, sent_at TEXT NOT NULL, status TEXT NOT NULL)');
  assert.equal(await notifyHealthIncident(event), 'skipped'); assert.equal(calls, 1);
});
test('independent cycles persist their heartbeat and record one incident opening until its condition changes', async () => {
  process.env.HEALTH_ALERT_WEBHOOK_URL = ''; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No network for read-only supervision.'); };
  const first = await runWatchdogCycle({ notify: false }), second = await runWatchdogCycle({ notify: false }); assert.equal(first.snapshot.watchdog.online, true); assert.equal(second.snapshot.watchdog.online, true); assert.equal(calls, 0);
  const rows = await query('SELECT details FROM newsroom_actions WHERE action=?', ['watchdog-incident-opened']);
  const news = rows.map(row => JSON.parse(String(row.details))).filter(value => value.code === 'heartbeat-missing' && value.component === 'Scheduler notizie'); assert.equal(news.length, 1);
  const before = Number((await query('SELECT COUNT(*) AS count FROM newsroom_actions WHERE action=?', ['watchdog-incident-recovered']))[0].count);
  await execute('INSERT INTO newsroom_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', ['worker', JSON.stringify({ state: 'online', lastHeartbeatAt: new Date().toISOString() }), new Date().toISOString()]);
  await runWatchdogCycle({ notify: false }); assert(Number((await query('SELECT COUNT(*) AS count FROM newsroom_actions WHERE action=?', ['watchdog-incident-recovered']))[0].count) > before);
});
test('optional authenticated web probe reports HTTP failure and service inspection contains no API key', async () => {
  process.env.HEALTHCHECK_PROBE_WEB = 'true'; process.env.HEALTHCHECK_SECRET = 'health-test-secret-'.repeat(3); process.env.SITE_URL = 'https://news.example.invalid'; let calls = 0;
  globalThis.fetch = async (input, init) => { calls++; assert(String(input).startsWith('https://news.example.invalid/api/admin/health?probe=1')); assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${process.env.HEALTHCHECK_SECRET}`); return new Response('down', { status: 503 }); };
  const result = await runWatchdogCycle({ notify: false }); assert.equal(calls, 1); assert.equal(result.snapshot.checks.find(check => check.id === 'web')?.state, 'error'); assert(!JSON.stringify(result).includes(process.env.HEALTHCHECK_SECRET));
  process.env.HEALTHCHECK_PROBE_WEB = 'false';
});

test('an unavailable schema returns an explicit error without leaking database driver information', async () => {
  await execute('DROP TABLE sports_sync_state');
  const result = await getServiceHealth();
  assert.equal(result.state, 'error'); assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].code, 'inspection-unavailable'); assert.equal(result.budget, null);
  assert(!JSON.stringify(result).includes('sports_sync_state'));
});
