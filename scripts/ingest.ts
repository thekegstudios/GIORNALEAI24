import { runNewsroomCycle } from '../src/lib/orchestrator';
import { closeDatabase } from '../src/lib/db';
try {
  const run = await runNewsroomCycle({force:process.argv.includes('--force'),reprocess:process.argv.includes('--reprocess')});
  console.log(JSON.stringify(run, null, 2));
  if (run.status === 'failed') process.exitCode = 1;
} finally { await closeDatabase(); }
