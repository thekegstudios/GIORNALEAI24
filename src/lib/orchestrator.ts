import { runIngestion, reprocessMetadata } from './pipeline';
import { rebuildHomepageEdition } from './homepage';
import { runNewsroomMonitoring } from './monitor';
import { logAction } from './audit';
import { runBriefingCycle } from './briefing';
import { runCivicCycle } from './civic';
let lastMonitoringAt=0;
let lastAuxiliaryAt=0;
/** One central entry point for the CLI, worker and authenticated scheduled endpoint. */
export async function runNewsroomCycle(options:{force?:boolean;reprocess?:boolean}={}) {
  const run=options.reprocess?await reprocessMetadata():await runIngestion({force:options.force});
  if(run.status!=='skipped'){
    await rebuildHomepageEdition();
    await logAction('supervisor','cycle-finished',run.id,{status:run.status,imported:run.imported,published:run.published,review:run.review,errors:run.errors},run.id);
  }
  if(run.status!=='skipped'||Date.now()-lastMonitoringAt>60_000){
    await runNewsroomMonitoring({checkLinks:run.status==='completed'||run.status==='partial'});
    lastMonitoringAt=Date.now();
  }
  if(run.status!=='skipped'||Date.now()-lastAuxiliaryAt>=60_000){for(const [module,work] of [['briefing',runBriefingCycle],['civic',runCivicCycle]] as const){try{await work();}catch(error){await logAction('supervisor',`${module}-cycle-error`,null,{error:error instanceof Error?error.message:'Modulo non disponibile; le notizie restano consultabili.'});}}lastAuxiliaryAt=Date.now();}
  return run;
}
