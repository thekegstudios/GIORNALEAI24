import { runNewsroomCycle } from '../src/lib/orchestrator';
import { getSettings } from '../src/lib/store';
import { closeDatabase, execute, query } from '../src/lib/db';
import { recordHeartbeat } from '../src/lib/monitor';
let stopping = false;
let wake: (() => void) | undefined;
let lastSkipReason = '';
const stop = () => { stopping = true; wake?.(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
console.log('GIORNALE AI24 · worker avviato. Intervallo dal database, default 5 minuti.');
let heartbeatBusy=false;
async function heartbeat(){if(heartbeatBusy||stopping)return;heartbeatBusy=true;try{const lock=(await query('SELECT owner FROM pipeline_locks WHERE id=? AND expires_at>?',['ingestion',new Date().toISOString()]))[0];await recordHeartbeat(lock?String(lock.owner):null);}catch(error){console.error(JSON.stringify({event:'heartbeat-failed',error:error instanceof Error?error.message:'Database non disponibile'}));}finally{heartbeatBusy=false;}}
await heartbeat();
const heartbeatTimer=setInterval(()=>{void heartbeat();},15_000);
try {
  while (!stopping) {
    try {
      const result = await runNewsroomCycle();
      const skipReason = result.errors.join(' · ');
      if (result.status !== 'skipped' || skipReason !== lastSkipReason) console.log(JSON.stringify({ at: new Date().toISOString(), event: 'ingestion', ...result }));
      lastSkipReason = result.status === 'skipped' ? skipReason : '';
      await execute('DELETE FROM reports WHERE created_at < ?', [new Date(Date.now() - 90 * 86400_000).toISOString()]);
      await execute('DELETE FROM rate_limits WHERE reset_at < ?', [new Date(Date.now() - 86400_000).toISOString()]);
    } catch (error) { console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : 'Errore worker' })); }
    if (stopping) break;
    let interval = 15_000;
    try {
      const settings = await getSettings();
      interval = Math.max(5, Math.min(1440, settings.intervalMinutes)) * 60_000;
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), event: 'settings-read-failed', error: error instanceof Error ? error.message : 'Database non disponibile; nuovo tentativo tra 15 secondi.' }));
    }
    // Poll every 15 seconds so changes and resume are picked up promptly; DB enforces interval.
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, Math.min(interval, 15_000)); wake = () => { clearTimeout(timer); resolve(); }; });
    wake = undefined;
  }
} finally { clearInterval(heartbeatTimer); try{await recordHeartbeat(null,true);}finally{await closeDatabase();} }
console.log('Worker arrestato.');
