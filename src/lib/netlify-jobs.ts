import { equalSecret } from './auth';

export type NetlifyJobTarget = 'news' | 'data' | 'sports' | 'watchdog' | 'briefing';
export type NetlifyJobOptions = { force?: boolean; reprocess?: boolean; reason?: string };
export type NetlifyNewsOptions = NetlifyJobOptions;
type Environment = Record<string, string | undefined>;
type JobState = 'running' | 'completed' | 'partial' | 'failed';
type JobRequest = { target: NetlifyJobTarget; options?: NetlifyNewsOptions; scheduledAt?: string };
type RuntimePayload = Record<string, unknown>;
type Fetcher = typeof fetch;
export interface NetlifyDispatchResult { target: NetlifyJobTarget; status: 'accepted' | 'disabled' | 'configuration-error' | 'failed'; reason?: string; httpStatus?: number }
export interface NetlifyJobServices {
  runNews(options: NetlifyNewsOptions): Promise<unknown>;
  runFuel(): Promise<unknown>;
  runEconomy(): Promise<unknown>;
  runSports(): Promise<unknown>;
  runBriefing(options: { force?: boolean; reason?: string }): Promise<unknown>;
  runWatchdog(options: { notify: boolean }): Promise<unknown>;
  notificationsConfigured(): Promise<boolean>;
  recordRuntime(id: string, payload: RuntimePayload): Promise<void>;
  now(): Date;
}
type Dependencies = { env?: Environment; fetcher?: Fetcher; now?: Date; services?: NetlifyJobServices };
const TARGETS: readonly NetlifyJobTarget[] = ['news', 'data', 'sports', 'watchdog', 'briefing'];
const BACKGROUND_PATH = '/.netlify/functions/ai24-job-background';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function siteOrigin(value: string | undefined): string | null {
  try {
    if (!value) return null;
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
    if (!host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)) return null;
    return url.origin;
  } catch { return null; }
}
function configuration(env: Environment): { ready: true; origin: string; secret: string } | { ready: false; reason: string; disabled: boolean } {
  if (env.NETLIFY_JOBS_ENABLED !== 'true') return { ready: false, reason: 'disabled', disabled: true };
  // CONTEXT is not guaranteed in Functions. The explicit enable flag must be
  // scoped to Production in Netlify; an incoming preview URL is checked too.
  if (env.CONTEXT && env.CONTEXT !== 'production' && env.NETLIFY_JOBS_ALLOW_PREVIEW !== 'true') return { ready: false, reason: 'preview-disabled', disabled: true };
  if (env.NETLIFY === 'false') return { ready: false, reason: 'not-netlify', disabled: true };
  const origin = siteOrigin(env.SITE_URL);
  if (!origin || env.URL && siteOrigin(env.URL) !== origin) return { ready: false, reason: 'invalid-origin', disabled: false };
  if (!(env.DATABASE_URL || env.NETLIFY_DB_URL)?.trim()) return { ready: false, reason: 'database-unconfigured', disabled: false };
  const secret = env.CRON_SECRET || '';
  if (secret.length < 32 || secret.length > 1024 || /[\r\n]/.test(secret)) return { ready: false, reason: 'secret-unconfigured', disabled: false };
  return { ready: true, origin, secret };
}
export function netlifyJobsStatus(env: Environment = process.env) {
  const configured = configuration(env);
  return configured.ready ? { enabled: true as const, reason: 'configured' } : { enabled: false as const, reason: configured.reason };
}
function sameConfiguredOrigin(request: Request, origin: string) {
  try { return new URL(request.url).origin === origin; } catch { return false; }
}
function validOptions(value: unknown, target: NetlifyJobTarget): value is NetlifyNewsOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return Object.keys(options).every(key => key === 'reason' ? typeof options.reason === 'string' && options.reason.trim().length > 0 && options.reason.length <= 1000 : ['force', ...(target === 'news' ? ['reprocess'] : [])].includes(key) && typeof options[key] === 'boolean') && !(options.force && options.reprocess);
}
function validJob(value: unknown): value is JobRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  return Object.keys(job).every(key => ['target', 'options', 'scheduledAt'].includes(key)) && TARGETS.includes(job.target as NetlifyJobTarget)
    && (job.options === undefined || ['news', 'briefing'].includes(String(job.target)) && validOptions(job.options, job.target as NetlifyJobTarget))
    && (job.scheduledAt === undefined || typeof job.scheduledAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(job.scheduledAt) && Number.isFinite(Date.parse(job.scheduledAt)));
}
async function readJob(request: Request): Promise<JobRequest | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return validJob(value) ? value : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

/** A 202 only confirms queue acceptance. Completion is recorded in the database. */
export async function dispatchNetlifyJob(target: NetlifyJobTarget, options: NetlifyNewsOptions = {}, dependencies: Dependencies & { scheduledAt?: string } = {}): Promise<NetlifyDispatchResult> {
  const env = dependencies.env || process.env, configured = configuration(env);
  if (!configured.ready) return { target, status: configured.disabled ? 'disabled' : 'configuration-error', reason: configured.reason };
  const job: JobRequest = { target, ...(Object.keys(options).length ? { options } : {}), ...(dependencies.scheduledAt ? { scheduledAt: dependencies.scheduledAt } : {}) };
  if (!validJob(job)) return { target, status: 'configuration-error', reason: 'invalid-job' };
  try {
    const result = await (dependencies.fetcher || fetch)(new URL(BACKGROUND_PATH, configured.origin), {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${configured.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(job)
    });
    await result.body?.cancel();
    return { target, status: result.status === 202 ? 'accepted' : 'failed', httpStatus: result.status };
  } catch { return { target, status: 'failed', reason: 'dispatch-unavailable' }; }
}

export function scheduledNetlifyJobs(now: Date, env: Environment = process.env): NetlifyJobTarget[] {
  if (!Number.isFinite(now.getTime())) return [];
  const minute = now.getUTCMinutes(), jobs: NetlifyJobTarget[] = ['watchdog'];
  if (minute % 5 === 0) jobs.push('news');
  if (minute === 0 && (env.FUEL_DATA_ENABLED !== 'false' || env.ECONOMIC_DATA_ENABLED !== 'false')) jobs.push('data');
  if (minute % 2 === 0 && env.SPORTS_ENABLED === 'true' && Boolean(env.APISPORTS_KEY?.trim())) jobs.push('sports');
  return jobs;
}
/** Short scheduler: it only dispatches authenticated background invocations. */
export async function handleNetlifySchedule(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.env || process.env, configured = configuration(env);
  if (!configured.ready) return response({ status: configured.disabled ? 'disabled' : 'configuration-error', reason: configured.reason }, configured.disabled ? 200 : 503);
  if (!sameConfiguredOrigin(request, configured.origin)) return response({ error: 'Origine non consentita.' }, 403);
  const now = dependencies.now || new Date(), scheduledAt = now.toISOString();
  const results = await Promise.all(scheduledNetlifyJobs(now, env).map(target => dispatchNetlifyJob(target, {}, { env, fetcher: dependencies.fetcher, scheduledAt })));
  return response({ status: results.every(result => result.status === 'accepted') ? 'accepted' : 'partial', jobs: results }, results.every(result => result.status === 'accepted') ? 200 : 503);
}

function defaultServices(): NetlifyJobServices {
  return {
    runNews: async options => (await import('./orchestrator')).runNewsroomCycle(options),
    runFuel: async () => (await import('./fuel')).runFuelImport(),
    runEconomy: async () => (await import('./economy')).runEconomicImport(),
    runSports: async () => (await import('./sports/sync')).runSportsCycle(),
    runBriefing: async options => (await import('./briefing')).runBriefingCycle(options),
    runWatchdog: async options => (await import('./service-health')).runWatchdogCycle(options),
    notificationsConfigured: async () => (await import('./service-health')).healthNotificationsConfigured(),
    recordRuntime: async (id, payload) => {
      const now = new Date().toISOString(), { execute } = await import('./db');
      await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', [id, JSON.stringify(payload), now]);
    },
    now: () => new Date()
  };
}
function resultStatus(value: unknown): string {
  const result = value && typeof value === 'object' ? value as { status?: unknown; state?: unknown } : {};
  const status = result.status ?? result.state;
  return typeof status === 'string' && ['completed', 'partial', 'failed', 'skipped', 'locked', 'disabled', 'unconfigured', 'no-authorized-competitions', 'published', 'review'].includes(status) ? status : 'unknown';
}
function outcome(statuses: string[]): Exclude<JobState, 'running'> {
  if (statuses.every(status => status === 'failed')) return 'failed';
  return statuses.some(status => status === 'failed' || status === 'partial' || status === 'unknown') ? 'partial' : 'completed';
}
async function safeRecord(services: NetlifyJobServices, id: string, payload: RuntimePayload) {
  try { await services.recordRuntime(id, payload); } catch { /* Actual service work and DB-outage monitoring must still be attempted. */ }
}
async function executeJob(job: JobRequest, services: NetlifyJobServices, env: Environment): Promise<JobState> {
  const startedAt = services.now().toISOString(), runtimeId = `netlify-job:${job.target}`;
  const initial = { mode: 'scheduled', state: 'running', startedAt, finishedAt: null, lastHeartbeatAt: startedAt };
  await safeRecord(services, runtimeId, initial);
  if (job.target === 'watchdog' && job.scheduledAt && Math.abs(Date.parse(startedAt) - Date.parse(job.scheduledAt)) <= 120_000) {
    await safeRecord(services, 'netlify-scheduler', { mode: 'scheduled', state: 'online', lastHeartbeatAt: job.scheduledAt, newsIntervalMinutes: 5, dataIntervalMinutes: 60, sportsIntervalMinutes: 2, watchdogIntervalMinutes: 1 });
  }
  let modules: Record<string, string> = {}, state: JobState = 'completed';
  try {
    if (job.target === 'data') {
      const results = await Promise.allSettled([services.runFuel(), services.runEconomy()]);
      modules = Object.fromEntries(results.map((result, index) => [['fuel', 'economy'][index], result.status === 'fulfilled' ? resultStatus(result.value) : 'failed']));
      state = outcome(Object.values(modules));
    } else if (job.target === 'news') {
      modules.news = resultStatus(await services.runNews(job.options || {})); state = outcome(Object.values(modules));
    } else if (job.target === 'sports') {
      if (env.SPORTS_ENABLED !== 'true' || !env.APISPORTS_KEY?.trim()) modules.sports = 'unconfigured';
      else modules.sports = resultStatus(await services.runSports());
      state = outcome(Object.values(modules));
    } else if (job.target === 'briefing') {
      modules.briefing = resultStatus(await services.runBriefing(job.options || {})); state = outcome(Object.values(modules));
    } else {
      await services.runWatchdog({ notify: await services.notificationsConfigured() }); modules.watchdog = 'completed';
    }
  } catch { state = 'failed'; modules = { [job.target]: 'failed' }; }
  const finishedAt = services.now().toISOString();
  await safeRecord(services, runtimeId, { ...initial, state, finishedAt, lastHeartbeatAt: finishedAt, modules });
  return state;
}

/** Netlify returns 202 before running a background handler: failed auth does no work. */
export async function handleNetlifyJob(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  if (request.method !== 'POST') return response({ error: 'Metodo non consentito.' }, 405);
  const env = dependencies.env || process.env, configured = configuration(env);
  if (!configured.ready) return response({ status: configured.disabled ? 'disabled' : 'configuration-error', reason: configured.reason }, configured.disabled ? 404 : 503);
  if (!sameConfiguredOrigin(request, configured.origin)) return response({ error: 'Origine non consentita.' }, 403);
  const authorization = request.headers.get('authorization') || '';
  if (authorization.length > 1100 || !equalSecret(authorization, `Bearer ${configured.secret}`)) return response({ error: 'Non autorizzato.' }, 401);
  const job = await readJob(request);
  if (!job) return response({ error: 'Job non valido.' }, 400);
  const state = await executeJob(job, dependencies.services || defaultServices(), env);
  // Background retries are safe: each module keeps its own persistent lock,
  // checkpoints, import guards and budget reservations. Never throw raw errors.
  if (state === 'failed') throw new Error('GIORNALE AI24: job pianificato non riuscito.');
  return response({ target: job.target, state });
}
