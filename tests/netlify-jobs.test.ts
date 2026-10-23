import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchNetlifyJob, handleNetlifyJob, handleNetlifySchedule, netlifyJobsStatus, scheduledNetlifyJobs, type NetlifyJobServices } from '../src/lib/netlify-jobs';

const secret = 'test-only-netlify-cron-secret-never-used-remotely';
const origin = 'https://giornale-ai24.example.org';
const env = { NETLIFY: 'true', CONTEXT: 'production', NETLIFY_JOBS_ENABLED: 'true', SITE_URL: origin, URL: origin, DATABASE_URL: 'postgresql://test:test@database.example.org/ai24', CRON_SECRET: secret };
const at = new Date('2026-10-23T06:00:00.000Z');
function request(body: unknown = { target: 'news' }, authorization = `Bearer ${secret}`, url = origin) {
  return new Request(`${url}/.netlify/functions/ai24-job-background`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function harness(overrides: Partial<NetlifyJobServices> = {}) {
  const calls: { target: string; options?: unknown }[] = [], records: { id: string; payload: Record<string, unknown> }[] = [];
  const services: NetlifyJobServices = {
    runNews: async options => { calls.push({ target: 'news', options }); return { status: 'completed' }; },
    runFuel: async () => { calls.push({ target: 'fuel' }); return { status: 'completed' }; },
    runEconomy: async () => { calls.push({ target: 'economy' }); return { status: 'completed' }; },
    runSports: async () => { calls.push({ target: 'sports' }); return { status: 'completed' }; },
    runBriefing: async options => { calls.push({ target: 'briefing', options }); return { status: 'completed' }; },
    runWatchdog: async options => { calls.push({ target: 'watchdog', options }); return {}; },
    notificationsConfigured: async () => false,
    recordRuntime: async (id, payload) => { records.push({ id, payload }); },
    now: () => at,
    ...overrides
  };
  return { services, calls, records };
}
const neverFetch: typeof fetch = async () => { throw new Error('No external request permitted in this test.'); };

test('Netlify jobs remain disabled by default and incomplete configuration never dispatches', async () => {
  assert.equal(netlifyJobsStatus({}).enabled, false);
  for (const invalid of [{ ...env, NETLIFY_JOBS_ENABLED: 'false' }, { ...env, DATABASE_URL: '' }, { ...env, CRON_SECRET: 'short' }]) {
    assert.equal(netlifyJobsStatus(invalid).enabled, false);
    const result = await dispatchNetlifyJob('news', {}, { env: invalid, fetcher: neverFetch });
    assert.notEqual(result.status, 'accepted');
    assert(!JSON.stringify(result).includes(secret));
  }
  assert.equal(netlifyJobsStatus({ ...env, DATABASE_URL: '', NETLIFY_DB_URL: env.DATABASE_URL }).enabled, true);
});

test('origin allowlist rejects insecure URLs, credentials, paths, local addresses and a different Netlify main URL', async () => {
  for (const site of ['http://giornale-ai24.example.org', 'https://user:password@giornale-ai24.example.org', `${origin}/path`, `${origin}?key=private`, 'https://localhost', 'https://127.0.0.1', 'https://service.internal', `${origin}:444`]) {
    assert.equal((await dispatchNetlifyJob('news', {}, { env: { ...env, SITE_URL: site }, fetcher: neverFetch })).status, 'configuration-error');
  }
  assert.equal(netlifyJobsStatus({ ...env, URL: 'https://other.example.org' }).reason, 'invalid-origin');
});

test('preview contexts are disabled without separate opt-in and incoming preview URLs cannot target production', async () => {
  assert.equal(netlifyJobsStatus({ ...env, CONTEXT: 'deploy-preview' }).reason, 'preview-disabled');
  const { services, calls } = harness();
  assert.equal((await handleNetlifyJob(request({ target: 'news' }, `Bearer ${secret}`, 'https://preview.example.org'), { env, services })).status, 403);
  assert.equal((await handleNetlifySchedule(new Request('https://preview.example.org/schedule'), { env, fetcher: neverFetch, now: at })).status, 403);
  assert.equal(calls.length, 0);
  const unknownContext = { ...env, CONTEXT: undefined };
  assert.equal((await handleNetlifyJob(request({ target: 'news' }, `Bearer ${secret}`, 'https://preview.example.org'), { env: unknownContext, services })).status, 403);
  const preview = { ...env, CONTEXT: 'deploy-preview', NETLIFY_JOBS_ALLOW_PREVIEW: 'true', SITE_URL: 'https://preview.example.org', URL: 'https://preview.example.org' };
  assert.equal(netlifyJobsStatus(preview).enabled, true);
});

test('background rejects wrong authentication and disabled requests before touching any service or runtime', async () => {
  const { services, calls, records } = harness();
  assert.equal((await handleNetlifyJob(request({}, 'Bearer wrong'), { env, services })).status, 401);
  assert.equal((await handleNetlifyJob(request({}, ''), { env, services })).status, 401);
  assert.equal((await handleNetlifyJob(request(), { env: { ...env, NETLIFY_JOBS_ENABLED: 'false' }, services })).status, 404);
  assert.equal((await handleNetlifyJob(new Request(`${origin}/job`), { env, services })).status, 405);
  assert.equal(calls.length, 0); assert.equal(records.length, 0);
});

test('background body is bounded and restricts targets, options and manual briefing reasons', async () => {
  const { services, calls } = harness();
  for (const body of [{ target: 'shell' }, { target: 'news', command: 'anything' }, { target: 'data', options: { force: true } }, { target: 'news', options: { force: true, reprocess: true } }, { target: 'briefing', options: { reprocess: true } }, { target: 'briefing', options: { reason: 'x'.repeat(1001) } }, { target: 'news', scheduledAt: 'not-a-date' }, { target: 'news', excess: 'x'.repeat(2000) }]) {
    assert.equal((await handleNetlifyJob(request(body), { env, services })).status, 400);
  }
  const plain = new Request(`${origin}/job`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal((await handleNetlifyJob(plain, { env, services })).status, 400);
  const oversized = new Request(`${origin}/job`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: `${' '.repeat(4096)}{"target":"news"}` });
  assert.equal((await handleNetlifyJob(oversized, { env, services })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await handleNetlifyJob(request({ target: 'briefing', options: { reason: 'è'.repeat(1000) } }), { env, services })).status, 200);
});

test('dispatch sends only a private POST to the configured origin and accepts only Netlify queue confirmation', async () => {
  let seen = 0;
  const fetcher: typeof fetch = async (input, init) => {
    seen++; assert.equal(String(input), `${origin}/.netlify/functions/ai24-job-background`);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${secret}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { target: 'news', options: { force: true } });
    assert(init?.signal); return new Response(null, { status: 202 });
  };
  assert.equal((await dispatchNetlifyJob('news', { force: true }, { env, fetcher })).status, 'accepted');
  assert.equal(seen, 1);
  assert.equal((await dispatchNetlifyJob('news', {}, { env, fetcher: async () => new Response('not background', { status: 200 }) })).status, 'failed');
  assert.equal((await dispatchNetlifyJob('news', {}, { env, fetcher: neverFetch })).reason, 'dispatch-unavailable');
});

test('schedule uses UTC frequencies and never enables an unconfigured or disabled sports provider', () => {
  assert.deepEqual(scheduledNetlifyJobs(at, env), ['watchdog', 'news', 'data']);
  assert.deepEqual(scheduledNetlifyJobs(new Date('2026-10-23T06:01:00Z'), env), ['watchdog']);
  assert.deepEqual(scheduledNetlifyJobs(new Date('2026-10-23T06:10:00Z'), { ...env, SPORTS_ENABLED: 'true', APISPORTS_KEY: 'test-only' }), ['watchdog', 'news', 'sports']);
  assert(!scheduledNetlifyJobs(at, { ...env, SPORTS_ENABLED: 'true' }).includes('sports'));
  assert(!scheduledNetlifyJobs(at, { ...env, FUEL_DATA_ENABLED: 'false', ECONOMIC_DATA_ENABLED: 'false' }).includes('data'));
  assert(!scheduledNetlifyJobs(at, env).includes('briefing'));
});

test('short scheduler dispatches jobs independently and reports a partial dispatch without hiding other results', async () => {
  const targets: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); targets.push(body.target); assert.equal(body.scheduledAt, at.toISOString());
    return new Response(null, { status: body.target === 'news' ? 503 : 202 });
  };
  const result = await handleNetlifySchedule(new Request(`${origin}/schedule`), { env, fetcher, now: at });
  assert.equal(result.status, 503); assert.deepEqual(targets.sort(), ['data', 'news', 'watchdog']);
  const body = await result.json(); assert.equal(body.status, 'partial'); assert.equal(body.jobs.filter((job: { status: string }) => job.status === 'accepted').length, 2);
  assert(!JSON.stringify(body).includes(secret));
});

test('news and manual briefing preserve bounded admin options and record actual job completion', async () => {
  const { services, calls, records } = harness();
  assert.equal((await handleNetlifyJob(request({ target: 'news', options: { reprocess: true } }), { env, services })).status, 200);
  assert.equal((await handleNetlifyJob(request({ target: 'briefing', options: { force: true, reason: 'Aggiornamento editoriale' } }), { env, services })).status, 200);
  assert.deepEqual(calls, [{ target: 'news', options: { reprocess: true } }, { target: 'briefing', options: { force: true, reason: 'Aggiornamento editoriale' } }]);
  assert.equal(records.find(record => record.id === 'netlify-job:news')?.payload.state, 'running');
  assert.equal(records.filter(record => record.id === 'netlify-job:news').at(-1)?.payload.state, 'completed');
});

test('data job attempts both importers and records partial failure without exposing provider errors', async () => {
  let economicCalls = 0;
  const { services, records } = harness({ runFuel: async () => { throw new Error(`Private provider URL ${secret}`); }, runEconomy: async () => { economicCalls++; return { status: 'completed' }; } });
  const result = await handleNetlifyJob(request({ target: 'data' }), { env, services });
  assert.equal(economicCalls, 1); assert.equal((await result.json()).state, 'partial');
  const last = records.at(-1)?.payload; assert.equal(last?.state, 'partial'); assert.deepEqual(last?.modules, { fuel: 'failed', economy: 'completed' });
  assert(!JSON.stringify(records).includes(secret));
});

test('reported importer failure is not changed into a successful job and complete failures throw a sanitized retry error', async () => {
  const { services, records } = harness({ runFuel: async () => ({ status: 'failed', error: secret }), runEconomy: async () => ({ status: 'failed', error: secret }) });
  await assert.rejects(handleNetlifyJob(request({ target: 'data' }), { env, services }), error => error instanceof Error && !error.message.includes(secret) && error.message.includes('non riuscito'));
  assert.equal(records.at(-1)?.payload.state, 'failed'); assert(!JSON.stringify(records).includes(secret));
});

test('briefing state is inspected without treating a reported failure as completion or a review draft as published', async () => {
  const failed = harness({ runBriefing: async () => ({ state: 'failed', reason: secret }) });
  await assert.rejects(handleNetlifyJob(request({ target: 'briefing' }), { env, services: failed.services }), /non riuscito/);
  assert.equal(failed.records.at(-1)?.payload.state, 'failed');
  const review = harness({ runBriefing: async () => ({ state: 'review', reason: 'Revisione richiesta.' }) });
  await handleNetlifyJob(request({ target: 'briefing' }), { env, services: review.services });
  assert.deepEqual(review.records.at(-1)?.payload.modules, { briefing: 'review' });
});

test('watchdog heartbeat proves a recent scheduler dispatch, never an old timestamp or manual invocation', async () => {
  const { services, records, calls } = harness();
  await handleNetlifyJob(request({ target: 'watchdog', scheduledAt: at.toISOString() }), { env, services });
  const scheduler = records.find(record => record.id === 'netlify-scheduler')?.payload;
  assert.deepEqual(scheduler, { mode: 'scheduled', state: 'online', lastHeartbeatAt: at.toISOString(), newsIntervalMinutes: 5, dataIntervalMinutes: 60, sportsIntervalMinutes: 2, watchdogIntervalMinutes: 1 });
  assert.deepEqual(calls, [{ target: 'watchdog', options: { notify: false } }]);
  const manual = harness(); await handleNetlifyJob(request({ target: 'watchdog' }), { env, services: manual.services });
  assert(!manual.records.some(record => record.id === 'netlify-scheduler'));
  const delayed = harness(); await handleNetlifyJob(request({ target: 'watchdog', scheduledAt: '2026-10-23T05:00:00.000Z' }), { env, services: delayed.services });
  assert(!delayed.records.some(record => record.id === 'netlify-scheduler'));
});

test('watchdog remains independent of runtime recording failure and notifies only through a configured channel', async () => {
  const { services, calls } = harness({ recordRuntime: async () => { throw new Error('Database unavailable'); }, notificationsConfigured: async () => true });
  await handleNetlifyJob(request({ target: 'watchdog' }), { env, services });
  assert.deepEqual(calls, [{ target: 'watchdog', options: { notify: true } }]);
});

test('direct sports invocation cannot enable an unconfigured provider or make a paid request', async () => {
  const { services, records, calls } = harness();
  await handleNetlifyJob(request({ target: 'sports' }), { env, services });
  assert.equal(calls.length, 0); assert.deepEqual(records.at(-1)?.payload.modules, { sports: 'unconfigured' });
  await handleNetlifyJob(request({ target: 'sports' }), { env: { ...env, SPORTS_ENABLED: 'true', APISPORTS_KEY: 'test-only' }, services });
  assert.equal(calls.length, 1); assert.equal(calls[0].target, 'sports');
});
