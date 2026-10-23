import { closeDatabase } from '../src/lib/db';
import { recordWatchdogHeartbeat, runWatchdogCycle, watchdogIntervalMs } from '../src/lib/service-health';

let stopping = false, wake: (() => void) | undefined, lastState = '', failures = 0;
const once = process.argv.includes('--once'), notify = !process.argv.includes('--no-notify');
const stop = () => { stopping = true; wake?.(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
console.log('GIORNALE AI24 · AI24 AUTOCONTROLLO avviato come processo indipendente.');
try {
  do {
    try {
      const result = await runWatchdogCycle({ notify });
      failures = result.snapshot.checks.some(check => check.id === 'database' && check.state === 'error') ? Math.min(5, failures + 1) : 0;
      const state = JSON.stringify({ state: result.snapshot.state, incidents: result.incidents, checks: result.snapshot.checks.map(check => `${check.id}:${check.state}:${check.code}`) });
      if (once || state !== lastState || result.notificationsSent || result.notificationsFailed) console.log(JSON.stringify({ at: result.snapshot.checkedAt, event: 'watchdog', state: result.snapshot.state, incidents: result.incidents, notificationsConfigured: result.snapshot.notifications.configured, notificationsSent: result.notificationsSent, notificationsFailed: result.notificationsFailed }));
      lastState = state;
    } catch { failures = Math.min(5, failures + 1); console.error(JSON.stringify({ at: new Date().toISOString(), event: 'watchdog-check-failed', message: 'Controllo non riuscito; nuovo tentativo limitato con backoff. Nessuna riparazione arbitraria eseguita.' })); }
    if (once || stopping) break;
    const delay = Math.min(5 * 60_000, watchdogIntervalMs() * 2 ** Math.max(0, failures - 1));
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, delay); wake = () => { clearTimeout(timer); resolve(); }; }); wake = undefined;
  } while (!stopping);
} finally { try { await recordWatchdogHeartbeat(true); } catch { /* A failed DB is reported without printing its connection details. */ } await closeDatabase(); }
console.log('AI24 AUTOCONTROLLO arrestato.');
