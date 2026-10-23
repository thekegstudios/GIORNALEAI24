import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execute, query, transaction } from './db';
import { getSettings, getSources } from './store';
import { getBudgetOverview, isAIConfigured } from './budget';
import { safePublicUrl } from './editorial';
import { logAction } from './audit';
import type { BudgetOverview } from './newsroom-types';

export type HealthState = 'ok' | 'warning' | 'error' | 'disabled' | 'unknown';
export interface ServiceHealthCheck { id: string; component: string; state: HealthState; code: string; message: string; lastSuccessAt: string | null; details: Record<string, string | number | boolean | null> }
export interface ServiceHealthSnapshot {
  checkedAt: string; state: 'active' | 'degraded' | 'suspended' | 'error'; checks: ServiceHealthCheck[];
  budget: BudgetOverview | null;
  notifications: { configured: boolean; channel: 'webhook' | null; cooldownMinutes: number };
  watchdog: { lastHeartbeatAt: string | null; online: boolean };
}
interface Runtime { lastCheckedAt?: string; lastSuccessAt?: string | null; lastError?: string | null; nextAttemptAt?: string; failures?: number; datasetDate?: string }
interface ScheduledRuntime { mode?: string; state?: string; lastHeartbeatAt?: string; startedAt?: string; finishedAt?: string }
interface Incident { fingerprint: string; component: string; code: string; state: 'warning' | 'error'; message: string; firstSeenAt: string; lastSeenAt: string }
interface AlertRecord { sentAt: string; status: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const unpack = <T>(value: unknown): T => JSON.parse(String(value));
const bounded = (value: string | undefined, fallback: number, min: number, max: number) => { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? Math.trunc(n) : fallback; };
const age = (value: string | null | undefined, now: Date) => value && Number.isFinite(Date.parse(value)) ? now.getTime() - Date.parse(value) : Infinity;
export function watchdogIntervalMs() { return bounded(process.env.WATCHDOG_INTERVAL_SECONDS, 60, 30, 300) * 1000; }
function cooldownMinutes() { return bounded(process.env.HEALTH_ALERT_COOLDOWN_MINUTES, 60, 15, 1440); }
function webhookUrl(): string | null {
  const url = process.env.HEALTH_ALERT_WEBHOOK_URL;
  return url && safePublicUrl(url) ? url : null;
}
export function healthNotificationsConfigured() { return webhookUrl() !== null; }
function cleanMessage(value: unknown) {
  return String(value || '').replace(/https?:\/\/[^\s]+/gi, '[URL della fonte]').replace(/(?:bearer\s+|api[_-]?key[=: ]+|password[=: ]+|token[=: ]+)\S+/gi, '[segreto omesso]').slice(0, 350);
}
async function runtime(id: string): Promise<Runtime | null> {
  const row = (await query('SELECT payload FROM public_data_runtime WHERE id=?', [id]))[0];
  return row ? unpack<Runtime>(row.payload) : null;
}
const check = (id: string, component: string, state: HealthState, code: string, message: string, lastSuccessAt: string | null = null, details: ServiceHealthCheck['details'] = {}): ServiceHealthCheck => ({ id, component, state, code, message, lastSuccessAt, details });

function recent(value: string | null | undefined, now: Date, maximumAge: number) { const elapsed = age(value, now); return elapsed >= -60_000 && elapsed < maximumAge; }
export function classifyScheduledJobHealth(target: string, value: ScheduledRuntime | null, options: { now?: Date; staleMinutes: number; enabled?: boolean }): ServiceHealthCheck {
  const now = options.now || new Date(), component = `Job Netlify ${target}`, id = `netlify-job:${target}`;
  if (options.enabled === false) return check(id, component, 'disabled', 'job-disabled', 'Modulo disattivato; nessuna esecuzione richiesta.');
  if (!value) return check(id, component, 'warning', 'job-never-run', 'Nessuna esecuzione del job registrata. Un heartbeat dello scheduler non dimostra che il job sia stato eseguito.');
  if (value.state === 'failed' || value.state === 'partial') return check(id, component, 'warning', `job-${value.state}`, `Ultimo job ${value.state === 'failed' ? 'fallito' : 'terminato con errori parziali'}. Consultare gli esiti riservati dei singoli moduli.`, null, { startedAt: value.startedAt || null, finishedAt: value.finishedAt || null });
  if (value.state === 'running') {
    const running = recent(value.startedAt, now, 14 * 60_000);
    return check(id, component, running ? 'ok' : 'warning', running ? 'job-running' : 'job-stalled', running ? 'Job in esecuzione; l’avvio non viene dichiarato un’importazione riuscita.' : 'Job ancora in esecuzione oltre 14 minuti oppure con orario di avvio non valido. Controllare il limite della funzione e il recupero della lease.', null, { startedAt: value.startedAt || null });
  }
  const completed = value.state === 'completed' && recent(value.finishedAt, now, options.staleMinutes * 60_000);
  return check(id, component, completed ? 'ok' : 'warning', completed ? 'job-current' : value.state === 'completed' ? 'job-stale' : 'job-state-invalid', completed ? 'Esecuzione del job terminata entro l’intervallo previsto. Gli esiti delle importazioni vengono verificati separatamente.' : 'Nessun completamento valido entro l’intervallo previsto. L’heartbeat dello scheduler non sostituisce l’esito del job.', value.state === 'completed' ? value.finishedAt || null : null, { startedAt: value.startedAt || null, finishedAt: value.finishedAt || null, staleMinutes: options.staleMinutes });
}

export function classifyImportHealth(component: string, value: Runtime | null, options: { now?: Date; enabled?: boolean; staleHours: number }): ServiceHealthCheck {
  const now = options.now || new Date();
  if (options.enabled === false) return check(component, component, 'disabled', 'disabled', 'Importazione disattivata nella configurazione server.');
  if (!value) return check(component, component, 'warning', 'never-imported', 'Nessuna importazione registrata: il servizio non è dichiarato aggiornato.');
  if (value.lastError) return check(component, component, 'warning', 'import-error', `Ultimo tentativo non riuscito: ${cleanMessage(value.lastError)}. L’ultimo dataset valido viene conservato.`, value.lastSuccessAt || null, { failures: value.failures || 0, nextAttemptAt: value.nextAttemptAt || null, lastCheckedAt: value.lastCheckedAt || null });
  if (age(value.lastSuccessAt, now) > options.staleHours * 3600_000) return check(component, component, 'warning', 'stale-import', 'L’ultima importazione riuscita supera l’intervallo previsto; controllare il worker e la fonte.', value.lastSuccessAt || null, { lastCheckedAt: value.lastCheckedAt || null, nextAttemptAt: value.nextAttemptAt || null });
  return check(component, component, 'ok', 'import-current', 'Importazione riuscita entro l’intervallo previsto; il periodo dei dati rimane distinto dall’orario del controllo.', value.lastSuccessAt || null, { lastCheckedAt: value.lastCheckedAt || null, datasetDate: value.datasetDate || null });
}

/** Read-only inspection: no source imports, model requests, notifications or retries are triggered here. */
export async function getServiceHealth(options: { now?: Date } = {}): Promise<ServiceHealthSnapshot> {
  const now = options.now || new Date(), checks: ServiceHealthCheck[] = [], notification = { configured: healthNotificationsConfigured(), channel: healthNotificationsConfigured() ? 'webhook' as const : null, cooldownMinutes: cooldownMinutes() };
  const empty: ServiceHealthSnapshot = { checkedAt: now.toISOString(), state: 'error', checks, budget: null, notifications: notification, watchdog: { lastHeartbeatAt: null, online: false } };
  try {
    const started = Date.now(); await query('SELECT 1 AS reachable'); checks.push(check('database', 'Database', 'ok', 'reachable', 'Connessione al database riuscita.', now.toISOString(), { responseMs: Date.now() - started }));
    const [settings, sources, workerRows, watchdogRows, runs, counts, leaseCounts, budget, usages, fuel, economy, fuelImport, fuelAudit, economicPeriod, sportsProviderRows, sportsSync, sportsUsage, competitions, briefingRows, failedActions] = await Promise.all([
      getSettings(), getSources(), query('SELECT payload FROM newsroom_runtime WHERE id=?', ['worker']), query('SELECT payload FROM public_data_runtime WHERE id=?', ['watchdog']), query('SELECT payload,started_at FROM pipeline_runs ORDER BY started_at DESC LIMIT 1'), query('SELECT state,COUNT(*) AS total,MIN(created_at) AS oldest FROM newsroom_jobs GROUP BY state'), query("SELECT COUNT(*) AS total FROM newsroom_jobs WHERE lease_expires_at<? AND lease_owner IS NOT NULL AND state NOT IN ('PUBLISHED','REJECTED','RETRACTED','UPDATED','FAILED','REVIEW_REQUIRED')", [now.toISOString()]), getBudgetOverview(), query('SELECT status,created_at FROM ai_usage WHERE created_at>=? ORDER BY created_at DESC', [new Date(now.getTime() - 24 * 3600_000).toISOString()]), runtime('fuel'), runtime('economy'), query('SELECT * FROM fuel_imports ORDER BY imported_at DESC LIMIT 1'), query('SELECT details,created_at FROM newsroom_actions WHERE action=? ORDER BY created_at DESC LIMIT 1', ['fuel-snapshot-imported']), query('SELECT MAX(period) AS latest FROM economic_indicators'), query('SELECT payload FROM sports_providers'), query('SELECT * FROM sports_sync_state'), query('SELECT requests,provider_remaining FROM sports_usage WHERE day=?', [now.toISOString().slice(0, 10)]), query('SELECT payload FROM sports_competitions'), query('SELECT state,error,updated_at FROM ai24_briefing_runs ORDER BY created_at DESC LIMIT 1'), query("SELECT COUNT(*) AS total FROM newsroom_actions WHERE action LIKE '%failed%' AND created_at>=?", [new Date(now.getTime() - 24 * 3600_000).toISOString()]),
    ]);
    const worker = workerRows[0] ? unpack<{ state?: string; lastHeartbeatAt?: string }>(workerRows[0].payload) : null, watcher = watchdogRows[0] ? unpack<{ state?: string; lastHeartbeatAt?: string }>(watchdogRows[0].payload) : null;
    const scheduledRows = await query('SELECT id,payload FROM public_data_runtime WHERE id IN (?,?,?,?,?,?)', ['data-worker', 'netlify-scheduler', 'netlify-job:news', 'netlify-job:data', 'netlify-job:sports', 'netlify-job:watchdog']);
    const scheduledRuntime = (id: string) => { const row = scheduledRows.find(value => value.id === id); return row ? unpack<ScheduledRuntime>(row.payload) : null; };
    const scheduled = scheduledRuntime('netlify-scheduler'), scheduledMode = process.env.SCHEDULER_MODE === 'http' && (process.env.NETLIFY === 'true' || scheduled?.mode === 'scheduled');
    const scheduledOnline = scheduled?.mode === 'scheduled' && scheduled?.state === 'online' && recent(scheduled.lastHeartbeatAt, now, 180_000);
    const dataWorkerRow = scheduledRows.find(value => value.id === 'data-worker');
    const dataWorker = dataWorkerRow ? unpack<{ state?: string; heartbeatAt?: string; lastHeartbeatAt?: string }>(dataWorkerRow.payload) : null;
    const dataHeartbeatAt = dataWorker?.lastHeartbeatAt || dataWorker?.heartbeatAt || null;
    const dataImportsEnabled = process.env.FUEL_DATA_ENABLED !== 'false' || process.env.ECONOMIC_DATA_ENABLED !== 'false';
    const dataWorkerOnline = dataWorker?.state === 'online' && age(dataHeartbeatAt, now) < 180_000;
    if (scheduledMode) {
      checks.push(check('netlify-scheduler', 'Scheduler Netlify', scheduledOnline ? 'ok' : 'error', scheduledOnline ? 'schedule-current' : 'schedule-heartbeat-missing', scheduledOnline ? 'Invocazione programmata recente registrata dal job watchdog. I completamenti dei singoli job vengono verificati separatamente.' : 'Nessuna invocazione programmata valida negli ultimi tre minuti. Un avvio manuale non dimostra che la pianificazione sia attiva.', scheduled?.lastHeartbeatAt || null));
      const dataJob = classifyScheduledJobHealth('data', scheduledRuntime('netlify-job:data'), { now, staleMinutes: 75, enabled: dataImportsEnabled });
      checks.push({ ...dataJob, id: 'data-worker', component: 'Job dati programmato' });
    } else checks.push(check('data-worker', 'Worker dati pubblici', !dataImportsEnabled ? 'disabled' : dataWorkerOnline ? 'ok' : 'warning', !dataImportsEnabled ? 'imports-disabled' : dataWorkerOnline ? 'heartbeat-current' : 'heartbeat-missing', !dataImportsEnabled ? 'Importazioni carburanti ed economia disattivate nella configurazione server.' : dataWorkerOnline ? 'Heartbeat del worker dati presente. Gli esiti e le date dei dataset vengono controllati separatamente.' : 'Heartbeat del worker dati assente o scaduto. Un’importazione recente non dimostra che il processo sia ancora in esecuzione.', dataHeartbeatAt));
    const workerOnline = worker?.state === 'online' && age(worker.lastHeartbeatAt, now) < 90_000, watcherHeartbeatOnline = watcher?.state === 'online' && recent(watcher.lastHeartbeatAt, now, watchdogIntervalMs() * 3);
    const watcherJob = scheduledMode ? classifyScheduledJobHealth('watchdog', scheduledRuntime('netlify-job:watchdog'), { now, staleMinutes: 3 }) : null;
    const watcherOnline = watcherHeartbeatOnline && (!scheduledMode || Boolean(scheduledOnline && watcherJob?.state === 'ok'));
    checks.push(check('watchdog', 'AI24 Autocontrollo', watcherOnline ? 'ok' : 'warning', watcherOnline ? scheduledMode ? 'scheduled-watchdog-current' : 'heartbeat-current' : scheduledMode && watcherJob?.state !== 'ok' ? watcherJob?.code || 'job-never-run' : 'heartbeat-missing', watcherOnline ? scheduledMode ? 'Controllo programmato e heartbeat del watchdog recenti. Il monitoraggio usa lo stesso provider del sito.' : 'Heartbeat del servizio indipendente presente.' : scheduledMode ? 'Pianificazione, esecuzione del job o heartbeat del watchdog assente, scaduto o non riuscito.' : 'Heartbeat del supervisore assente o scaduto. Avviare il processo watchdog separato.', watcher?.lastHeartbeatAt || null));
    if (process.env.HEALTHCHECK_PROBE_WEB === 'true') {
      const previousWeb = (await query('SELECT payload FROM public_data_runtime WHERE id=?', ['watchdog:health']))[0];
      const previousSnapshot = previousWeb ? unpack<ServiceHealthSnapshot>(previousWeb.payload) : null, webCheck = previousSnapshot?.checks.find(value => value.id === 'web');
      checks.push(webCheck && age(previousSnapshot?.checkedAt, now) < watchdogIntervalMs() * 3 ? webCheck : check('web', 'Servizio web', 'warning', 'probe-stale', 'Nessun probe HTTP autenticato recente registrato dal watchdog.'));
    } else checks.push(check('web', 'Servizio web', 'disabled', 'probe-disabled', 'Probe HTTP esterno disattivato. Il controllo del database non prova che il frontend sia raggiungibile.'));
    const activeSources = sources.filter(source => source.authorized && source.enabled), latestScan = activeSources.map(source => source.lastCheckedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
    const newsJob = scheduledMode ? classifyScheduledJobHealth('news', scheduledRuntime('netlify-job:news'), { now, staleMinutes: 12 }) : null;
    const schedulerOnline = process.env.SCHEDULER_MODE === 'http' ? recent(latestScan, now, settings.intervalMinutes * 120_000 + 60_000) && (!scheduledMode || Boolean(scheduledOnline && newsJob?.state === 'ok')) : workerOnline;
    checks.push(check('news-scheduler', 'Scheduler notizie', settings.paused ? 'disabled' : schedulerOnline ? 'ok' : 'error', settings.paused ? 'paused' : schedulerOnline ? 'current' : scheduledMode && newsJob?.state !== 'ok' ? newsJob?.code || 'job-never-run' : 'heartbeat-missing', settings.paused ? 'Automazione sospesa da un amministratore.' : schedulerOnline ? `Controllo ${scheduledMode ? 'Netlify programmato' : process.env.SCHEDULER_MODE === 'http' ? 'HTTP' : 'worker'} presente entro l’intervallo previsto.` : 'Il servizio delle notizie non presenta un heartbeat/controllo e un esito recente: le visite non possono riavviarlo.', latestScan, { workerHeartbeatAt: scheduledMode ? null : worker?.lastHeartbeatAt || null, scheduledHeartbeatAt: scheduledMode ? scheduled?.lastHeartbeatAt || null : null, configuredIntervalMinutes: settings.intervalMinutes }));
    const lastRun = runs[0] ? unpack<{ status?: string; finishedAt?: string; errors?: string[] }>(runs[0].payload) : null;
    const staleRun = lastRun?.status === 'running' && age(String(runs[0].started_at), now) > 10 * 60_000;
    const runErrors = Array.isArray(lastRun?.errors) ? lastRun.errors.length : 0;
    checks.push(check('news-last-run', 'Ultima esecuzione notizie', settings.paused ? 'disabled' : staleRun || lastRun?.status === 'failed' || lastRun?.status === 'partial' || runErrors ? 'warning' : lastRun ? 'ok' : 'unknown', staleRun ? 'run-stalled' : lastRun?.status || 'never-run', lastRun ? staleRun ? 'Un’esecuzione risulta ancora in corso oltre 10 minuti. Le lease scadute vengono recuperate dal worker con i limiti previsti.' : `Ultimo esito registrato: ${lastRun.status}; ${runErrors} errori conservati nel registro riservato.` : 'Nessuna esecuzione registrata.', lastRun?.finishedAt || null, { errors: runErrors }));
    const sourceErrors = activeSources.filter(source => source.lastError || age(source.lastCheckedAt, now) > settings.intervalMinutes * 120_000 + 60_000);
    checks.push(check('news-sources', 'Fonti giornalistiche', settings.paused ? 'disabled' : !activeSources.length || sourceErrors.length ? 'warning' : 'ok', !activeSources.length ? 'no-active-sources' : sourceErrors.length ? 'source-errors' : 'current', `${activeSources.length} fonti autorizzate attive; ${sourceErrors.length} con errori o controlli in ritardo.`, latestScan, { active: activeSources.length, unavailable: sourceErrors.length }));
    const failed = Number(counts.find(row => row.state === 'FAILED')?.total || 0), queued = counts.filter(row => ['DISCOVERED', 'NORMALIZED', 'VERIFYING', 'DRAFT', 'APPROVED'].includes(String(row.state))).reduce((sum, row) => sum + Number(row.total), 0), expired = Number(leaseCounts[0]?.total || 0);
    checks.push(check('news-queue', 'Coda persistente', failed || expired || queued > Math.max(25, settings.maxItemsPerRun * 10) ? 'warning' : 'ok', failed ? 'dead-letter' : expired ? 'expired-leases' : queued > Math.max(25, settings.maxItemsPerRun * 10) ? 'backlog' : 'within-capacity', `${queued} elementi da elaborare, ${failed} job falliti, ${expired} lease scadute.`, null, { queued, deadLetter: failed, expiredLeases: expired }));
    const failures = usages.filter(row => row.status === 'failed').length, reservedStale = usages.filter(row => row.status === 'reserved' && age(String(row.created_at), now) > 10 * 60_000).length, completedCalls = usages.filter(row => row.status === 'completed');
    const configured = isAIConfigured(settings.aiModel);
    checks.push(check('openai', 'OpenAI', !configured ? 'disabled' : failures || reservedStale ? 'warning' : completedCalls.length ? 'ok' : 'unknown', !configured ? 'not-configured' : failures ? 'request-failures' : reservedStale ? 'uncertain-reservations' : completedCalls.length ? 'requests-completed' : usages.length ? 'requests-pending' : 'never-called', !configured ? 'Chiave e tariffe coerenti non configurate: nessuna richiesta di prova a pagamento.' : `${usages.length} richieste registrate nelle ultime 24 ore; ${completedCalls.length} completate, ${failures} fallite, ${reservedStale} prenotazioni con esito incerto. La configurazione non equivale a un test live dell’API.`, completedCalls[0]?.created_at ? String(completedCalls[0].created_at) : null, { requests: usages.length, completedRequests: completedCalls.length, failures, uncertainReservations: reservedStale }));
    const capped = budget.remainingTodayUsd <= 0 || budget.remainingMonthUsd <= 0;
    checks.push(check('ai-budget', 'Budget AI', capped || budget.warning ? 'warning' : 'ok', capped ? 'cap-reached' : budget.warning ? 'near-cap' : 'within-cap', capped ? 'Un limite di spesa è raggiunto: nuove prenotazioni AI bloccate. I dati già pubblicati rimangono leggibili.' : budget.warning ? 'Consumo AI oltre la soglia di avviso del budget configurato.' : 'Spesa stimata e prenotazioni entro i limiti globali.', now.toISOString(), { spentTodayUsd: budget.spentTodayUsd, dailyLimitUsd: budget.dailyBudgetUsd, spentMonthUsd: budget.spentMonthUsd, monthlyLimitUsd: budget.monthlyBudgetUsd, inputTokens: budget.inputTokens, outputTokens: budget.outputTokens }));
    checks.push(classifyImportHealth('Carburanti MIMIT', fuel, { now, enabled: process.env.FUEL_DATA_ENABLED !== 'false', staleHours: 36 }));
    if (fuelImport[0]) {
      const datasetDate = String(fuelImport[0].dataset_date || ''), stale = age(`${datasetDate}T12:00:00Z`, now) > 3 * 86400_000;
      checks.push(check('fuel-dataset', 'Dataset carburanti', stale ? 'warning' : 'ok', stale ? 'old-dataset' : 'dataset-current', `Dataset ${datasetDate || 'con data non disponibile'}; ${Number(fuelImport[0].station_count)} impianti, ${Number(fuelImport[0].price_count)} prezzi. Non viene presentato come rilevazione di oggi.`, String(fuelImport[0].imported_at), { datasetDate, stations: Number(fuelImport[0].station_count), prices: Number(fuelImport[0].price_count) }));
    }
    if (fuelAudit[0]) { const record = unpack<{ rejected?: number; prices?: number }>(fuelAudit[0].details), rejected = Number(record.rejected || 0), prices = Number(record.prices || 0); checks.push(check('fuel-rejected', 'Righe carburanti scartate', rejected > Math.max(100, prices * 0.01) ? 'warning' : 'ok', rejected > Math.max(100, prices * 0.01) ? 'many-rejected-rows' : 'validation-recorded', `${rejected} righe non valide scartate nell’ultimo dataset accettato. Gli scarti non diventano prezzi pubblicati.`, String(fuelAudit[0].created_at), { rejectedRows: rejected, acceptedPrices: prices })); }
    checks.push(classifyImportHealth('Indicatori economici', economy, { now, enabled: process.env.ECONOMIC_DATA_ENABLED !== 'false', staleHours: 48 }));
    const latestPeriod = economicPeriod[0]?.latest ? String(economicPeriod[0].latest) : null;
    checks.push(check('economic-period', 'Periodo statistico', latestPeriod ? age(`${latestPeriod}-01T12:00:00Z`, now) > 100 * 86400_000 ? 'warning' : 'ok' : 'unknown', latestPeriod ? 'period-recorded' : 'no-observations', latestPeriod ? `Ultimo periodo disponibile: ${latestPeriod}. Un controllo odierno non modifica il periodo di riferimento.` : 'Nessuna osservazione economica disponibile; nessuna serie simulata.', null, { latestPeriod }));
    checks.push(check('istat-arera', 'ISTAT e ARERA', 'unknown', 'direct-connectors-unconfigured', 'Il connettore statistico attuale usa Eurostat per l’Italia. Le integrazioni dirette ISTAT e ARERA non risultano configurate e non sono dichiarate operative.'));
    const sportsEnabled = process.env.SPORTS_ENABLED === 'true' && Boolean(process.env.APISPORTS_KEY), provider = sportsProviderRows[0] ? unpack<{ enabled?: boolean; dailyLimit?: number }>(sportsProviderRows[0].payload) : null;
    if (scheduledMode) checks.push(classifyScheduledJobHealth('sports', scheduledRuntime('netlify-job:sports'), { now, staleMinutes: 10, enabled: sportsEnabled && provider?.enabled === true }));
    const enabledCompetitions = competitions.filter(row => unpack<{ enabled?: boolean }>(row.payload).enabled).length, syncErrors = sportsSync.filter(row => row.last_error || Number(row.failures) > 0), staleSports = sportsSync.filter(row => age(String(row.next_at), now) > 15 * 60_000 && (!row.locked_until || Date.parse(String(row.locked_until)) < now.getTime()));
    checks.push(check('sports', 'API sportive', !sportsEnabled || !provider?.enabled ? 'disabled' : syncErrors.length || staleSports.length ? 'warning' : enabledCompetitions && sportsSync.length ? 'ok' : 'unknown', !sportsEnabled || !provider?.enabled ? 'not-configured' : syncErrors.length ? 'sync-errors' : staleSports.length ? 'sync-late' : !enabledCompetitions ? 'no-competitions' : sportsSync.length ? 'sync-monitored' : 'no-sync-records', !sportsEnabled || !provider?.enabled ? 'Provider sportivo non abilitato/configurato; nessuna chiamata di controllo a pagamento.' : `${enabledCompetitions} competizioni abilitate; ${syncErrors.length} task con errori, ${staleSports.length} in ritardo.`, sportsSync.map(row => row.last_success ? String(row.last_success) : '').sort().at(-1) || null, { competitions: enabledCompetitions, requestsToday: sportsUsage.reduce((sum, row) => sum + Number(row.requests), 0), syncErrors: syncErrors.length, lateTasks: staleSports.length }));
    if (sportsEnabled && sportsUsage.some(row => row.provider_remaining !== null && Number(row.provider_remaining) <= 0)) checks.push(check('sports-cap', 'Quota API sportive', 'warning', 'provider-cap-reached', 'Il provider segnala quota esaurita. La sincronizzazione attende il ripristino senza forzare richieste.'));
    if (briefingRows[0]) checks.push(check('briefing', 'AI24 Briefing', briefingRows[0].state === 'failed' || briefingRows[0].state === 'running' && age(String(briefingRows[0].updated_at), now) > 5 * 60_000 ? 'warning' : briefingRows[0].state === 'review' ? 'unknown' : 'ok', String(briefingRows[0].state), briefingRows[0].error ? `Ultimo briefing non riuscito: ${cleanMessage(briefingRows[0].error)}` : `Ultimo esito: ${String(briefingRows[0].state)}. La bozza in revisione non è una pubblicazione.`, String(briefingRows[0].updated_at)));
    else checks.push(check('briefing', 'AI24 Briefing', 'unknown', 'no-briefing-attempt', 'Nessuna generazione registrata; possono mancare articoli originali verificati idonei.'));
    const failuresLogged = Number(failedActions[0]?.total || 0); checks.push(check('application-errors', 'Eventi server', failuresLogged ? 'warning' : 'ok', failuresLogged ? 'failures-recorded' : 'no-failures-recorded', `${failuresLogged} eventi di fallimento registrati nelle ultime 24 ore. Il controllo non misura errori JavaScript nei browser.`, null, { failuresLogged }));
    const heartbeatAt = watcher?.lastHeartbeatAt || null;
    return { checkedAt: now.toISOString(), state: settings.paused || settings.safetyMode ? 'suspended' : checks.some(item => item.state === 'error') ? 'error' : checks.some(item => item.state === 'warning') ? 'degraded' : 'active', checks, budget, notifications: notification, watchdog: { lastHeartbeatAt: heartbeatAt, online: watcherOnline } };
  } catch {
    // Connection errors may contain credentials. Never copy raw driver errors to an alert or public API.
    checks.splice(0, checks.length, check('database', 'Database', 'error', 'inspection-unavailable', 'Database o schema non raggiungibile durante il controllo. Consultare il log riservato del servizio senza esporre credenziali.'));
    return empty;
  }
}

function alertMayRun(previous: AlertRecord | undefined, now: Date): { allowed: boolean; attempt: number } {
  if (!previous) return { allowed: true, attempt: 1 };
  const elapsed = age(previous.sentAt, now), attempt = Number(previous.status.match(/:(\d+)$/)?.[1] || 0);
  if (previous.status === 'sent' && elapsed < cooldownMinutes() * 60_000) return { allowed: false, attempt: 0 };
  if (previous.status.startsWith('sending') && elapsed < 120_000) return { allowed: false, attempt: 0 };
  if (previous.status.startsWith('failed') && attempt < 3 && elapsed < 30_000 * 2 ** Math.max(0, attempt - 1)) return { allowed: false, attempt: 0 };
  if (attempt >= 3 && elapsed < cooldownMinutes() * 60_000) return { allowed: false, attempt: 0 };
  return { allowed: true, attempt: elapsed >= cooldownMinutes() * 60_000 ? 1 : Math.min(3, attempt + 1) };
}
export function watchdogStateDirectory() {
  // Netlify function bundles are read-only; this fallback is deliberately ephemeral.
  return path.resolve(process.env.WATCHDOG_STATE_DIR || (process.env.NETLIFY === 'true' ? path.join(tmpdir(), 'giornale-ai24-watchdog') : path.join(process.cwd(), 'data')));
}
function alertPaths() {
  const directory = watchdogStateDirectory();
  return { directory, state: path.join(directory, 'watchdog-alerts.json'), lock: path.join(directory, 'watchdog-alerts.lock') };
}
async function readFallbackAlerts(): Promise<Record<string, AlertRecord>> {
  try {
    const contents = await readFile(alertPaths().state, 'utf8'); if (contents.length > 200_000) return {};
    const parsed: unknown = JSON.parse(contents); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => /^[a-f0-9]{64}$/.test(key) && value && typeof value === 'object' && typeof value.sentAt === 'string' && typeof value.status === 'string' && /^(?:pending|sent|sending:[123]|failed:[123])$/.test(value.status)));
  } catch { return {}; }
}
async function withFallbackAlerts<T>(work: (records: Record<string, AlertRecord>) => Promise<T>): Promise<T | null> {
  const files = alertPaths(); await mkdir(files.directory, { recursive: true });
  let temporary: string | undefined;
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(files.lock, 'wx', 0o600); } catch {
    try { if (Date.now() - (await stat(files.lock)).mtimeMs > 120_000) { await unlink(files.lock); handle = await open(files.lock, 'wx', 0o600); } else return null; } catch { return null; }
  }
  try {
    const records = await readFallbackAlerts(), result = await work(records); temporary = path.join(files.directory, `watchdog-alerts.${process.pid}.${randomUUID()}.tmp`);
    const entries = Object.entries(records).filter(([key, value]) => /^[a-f0-9]{64}$/.test(key) && age(value.sentAt, new Date()) < 7 * 86400_000).slice(-200);
    await writeFile(temporary, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600, flush: true }); await rename(temporary, files.state);
    return result;
  } finally { if (temporary) await unlink(temporary).catch(() => undefined); await handle.close(); await unlink(files.lock).catch(() => undefined); }
}
async function claimAlert(fingerprint: string, now: Date): Promise<{ attempt: number; fallback: boolean } | null> {
  const saved = (await readFallbackAlerts())[fingerprint];
  if (saved && !alertMayRun(saved, now).allowed) return null;
  try {
    return await transaction(async () => {
      // Insert first so concurrent PostgreSQL processes serialize on the fingerprint row.
      await execute('INSERT INTO admin_alerts (fingerprint,sent_at,status) VALUES (?,?,?) ON CONFLICT(fingerprint) DO NOTHING', [fingerprint, '1970-01-01T00:00:00.000Z', 'pending']);
      await execute('UPDATE admin_alerts SET status=status WHERE fingerprint=?', [fingerprint]);
      const row = (await query('SELECT sent_at,status FROM admin_alerts WHERE fingerprint=?', [fingerprint]))[0];
      const result = alertMayRun(row ? { sentAt: String(row.sent_at), status: String(row.status) } : undefined, now);
      if (!result.allowed) return null;
      await execute('UPDATE admin_alerts SET sent_at=?,status=? WHERE fingerprint=?', [now.toISOString(), `sending:${result.attempt}`, fingerprint]);
      return { attempt: result.attempt, fallback: false };
    });
  } catch {
    return withFallbackAlerts(async records => {
      const result = alertMayRun(records[fingerprint], now); if (!result.allowed) return null;
      records[fingerprint] = { sentAt: now.toISOString(), status: `sending:${result.attempt}` };
      return { attempt: result.attempt, fallback: true };
    });
  }
}
async function settleAlert(fingerprint: string, attempt: number, success: boolean, fallback: boolean, now: Date) {
  const value = { sentAt: now.toISOString(), status: success ? 'sent' : `failed:${attempt}` };
  if (!fallback) { try { await execute('UPDATE admin_alerts SET sent_at=?,status=? WHERE fingerprint=?', [value.sentAt, value.status, fingerprint]); return; } catch { /* Preserve cooldown even when the database fails after the HTTP request. */ } }
  await withFallbackAlerts(async records => { records[fingerprint] = value; });
}
export async function notifyHealthIncident(incident: Incident, now = new Date()): Promise<'sent' | 'failed' | 'skipped' | 'unconfigured'> {
  const url = webhookUrl(); if (!url) return 'unconfigured';
  let claimed: Awaited<ReturnType<typeof claimAlert>>;
  try { claimed = await claimAlert(incident.fingerprint, now); } catch { return 'failed'; }
  if (!claimed) return 'skipped';
  let success = false;
  try {
    const text = `GIORNALE AI24 · AUTOCONTROLLO\n${incident.state === 'error' ? 'Errore' : 'Attenzione'}: ${incident.component}\nCodice: ${incident.code}\nRilevato: ${incident.firstSeenAt}\nApri il pannello amministrativo Autocontrollo per i dettagli.`;
    const secret = process.env.HEALTH_ALERT_WEBHOOK_SECRET, headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret && secret.length <= 1024 && !/[\r\n]/.test(secret)) headers.Authorization = `Bearer ${secret}`;
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers, body: JSON.stringify({ text, event: 'ai24-health-incident', severity: incident.state, component: incident.component, code: incident.code, detectedAt: incident.firstSeenAt }) });
    success = response.ok; await response.body?.cancel();
  } catch { /* Webhook URL, response and connection details may contain secrets; keep them out of the audit. */ }
  await settleAlert(incident.fingerprint, claimed.attempt, success, claimed.fallback, now);
  try { await logAction('supervisor', success ? 'watchdog-alert-sent' : 'watchdog-alert-failed', incident.fingerprint, { component: incident.component, code: incident.code, attempt: claimed.attempt, channel: 'configured-webhook', fallbackStore: claimed.fallback }); } catch { /* Local fallback preserves delivery status during a database outage. */ }
  return success ? 'sent' : 'failed';
}

export async function recordWatchdogHeartbeat(stopped = false) {
  const now = new Date().toISOString();
  await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', ['watchdog', JSON.stringify({ state: stopped ? 'stopped' : 'online', lastHeartbeatAt: now, pid: process.pid }), now]);
}
export async function getWatchdogHistory(): Promise<{ at: string; action: string; component: string | null; code: string | null }[]> {
  try {
    const rows = await query("SELECT action,details,created_at FROM newsroom_actions WHERE action LIKE 'watchdog-%' ORDER BY created_at DESC LIMIT 50");
    return rows.map(row => { const details = unpack<{ component?: string; code?: string }>(row.details); return { at: String(row.created_at), action: String(row.action), component: details.component || null, code: details.code || null }; });
  } catch { return []; }
}
async function probeWeb(): Promise<ServiceHealthCheck | null> {
  if (process.env.HEALTHCHECK_PROBE_WEB !== 'true') return null;
  const secret = process.env.HEALTHCHECK_SECRET || process.env.CRON_SECRET;
  if (!process.env.SITE_URL || !secret || secret.length < 32) return check('web', 'Servizio web', 'unknown', 'probe-unconfigured', 'Probe HTTP richiesto ma URL del sito o segreto non configurati.');
  try {
    const target = new URL('/api/admin/health?probe=1', process.env.SITE_URL);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('URL non valido.');
    const response = await fetch(target, { headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' });
    await response.body?.cancel();
    return check('web', 'Servizio web', response.ok ? 'ok' : 'error', response.ok ? 'reachable' : 'probe-http-error', response.ok ? 'Endpoint web autenticato raggiungibile.' : `Endpoint web ha risposto HTTP ${response.status}.`, response.ok ? new Date().toISOString() : null, { httpStatus: response.status });
  } catch { return check('web', 'Servizio web', 'error', 'unreachable', 'Servizio web non raggiungibile entro il timeout del probe autenticato.'); }
}
export async function runWatchdogCycle(options: { notify?: boolean } = {}) {
  const now = new Date(), owner = randomUUID(); let locked = false;
  try {
    const rows = await query('INSERT INTO pipeline_locks (id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE pipeline_locks.expires_at<=? RETURNING owner', ['watchdog', owner, new Date(now.getTime() + 120_000).toISOString(), now.toISOString()]);
    if (rows[0]?.owner !== owner) return { snapshot: await getServiceHealth(), incidents: 0, notificationsSent: 0, notificationsFailed: 0, skipped: true };
    locked = true;
  } catch { /* The DB outage check still runs; file-based notification claims prevent duplicate alerts. */ }
  try {
  try { await recordWatchdogHeartbeat(); } catch { /* Independent DB outage detection and webhook fallback still run below. */ }
  const snapshot = await getServiceHealth({ now }), web = await probeWeb();
  if (web) {
    snapshot.checks = snapshot.checks.filter(check => check.id !== 'web'); snapshot.checks.push(web);
    if (snapshot.state !== 'suspended') snapshot.state = snapshot.checks.some(check => check.state === 'error') ? 'error' : snapshot.checks.some(check => check.state === 'warning') ? 'degraded' : 'active';
  }
  let previous: Incident[] = [];
  try { const row = (await query('SELECT payload FROM public_data_runtime WHERE id=?', ['watchdog:incidents']))[0]; previous = row ? unpack<Incident[]>(row.payload) : []; } catch { /* Database incident has no writable audit until recovery. */ }
  const incidents: Incident[] = snapshot.checks.filter((item): item is ServiceHealthCheck & { state: 'warning' | 'error' } => item.state === 'warning' || item.state === 'error').map(item => {
    const fingerprint = hash(`${item.id}:${item.code}:${item.state}`), prior = previous.find(value => value.fingerprint === fingerprint);
    return { fingerprint, component: item.component, code: item.code, state: item.state, message: item.message, firstSeenAt: prior?.firstSeenAt || now.toISOString(), lastSeenAt: now.toISOString() };
  });
  let sent = 0, failed = 0;
  for (const incident of incidents) {
    if (!previous.some(value => value.fingerprint === incident.fingerprint)) try { await logAction('supervisor', 'watchdog-incident-opened', incident.fingerprint, { ...incident, automaticAction: 'Segnalazione; recuperi limitati demandati ai worker già autorizzati. Nessuna modifica a codice, credenziali o dati.' }); } catch { /* No raw database error is logged. */ }
    if (options.notify !== false && sent + failed < 3) { const result = await notifyHealthIncident(incident, now); if (result === 'sent') sent++; if (result === 'failed') failed++; }
  }
  for (const previousIncident of previous) if (!incidents.some(incident => incident.fingerprint === previousIncident.fingerprint)) try { await logAction('supervisor', 'watchdog-incident-recovered', previousIncident.fingerprint, { component: previousIncident.component, code: previousIncident.code, firstSeenAt: previousIncident.firstSeenAt, recoveredAt: now.toISOString() }); } catch { /* The next successful cycle can retain fresh state. */ }
  try {
    for (const [id, payload] of [['watchdog:incidents', incidents], ['watchdog:health', snapshot]] as const) await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', [id, JSON.stringify(payload), now.toISOString()]);
  } catch { /* The running process and optional webhook remain independent of database writes. */ }
  return { snapshot, incidents: incidents.length, notificationsSent: sent, notificationsFailed: failed };
  } finally { if (locked) await execute('DELETE FROM pipeline_locks WHERE id=? AND owner=?', ['watchdog', owner]).catch(() => undefined); }
}
