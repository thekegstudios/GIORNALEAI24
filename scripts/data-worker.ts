import { runFuelImport } from '../src/lib/fuel';
import { runEconomicImport } from '../src/lib/economy';
import { closeDatabase, execute } from '../src/lib/db';
let stopping=false,wake:(()=>void)|undefined,heartbeatBusy=false;
const stop=()=>{stopping=true;wake?.();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const once=process.argv.includes('--once');
async function heartbeat(state='online'){
  if(heartbeatBusy)return;heartbeatBusy=true;
  try{const now=new Date().toISOString();await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',['data-worker',JSON.stringify({lastHeartbeatAt:now,state}),now]);}
  catch{console.error(JSON.stringify({module:'data-worker',event:'heartbeat-failed',error:'Database non disponibile.'}));}
  finally{heartbeatBusy=false;}
}
await heartbeat();
const heartbeatTimer=setInterval(()=>void heartbeat(),15000);
try{do{
  try{for(const [module,run] of [['fuel',runFuelImport],['economy',runEconomicImport]] as const){const result=await run({force:process.argv.includes('--force')});if(result.status!=='skipped')console.log(JSON.stringify({module,at:new Date().toISOString(),...result}));}}
  catch(error){console.error(JSON.stringify({module:'data-worker',error:error instanceof Error?error.message:'Database non disponibile'}));}
  if(stopping||once)break;await new Promise<void>(resolve=>{const timer=setTimeout(resolve,60000);wake=()=>{clearTimeout(timer);resolve();};});wake=undefined;
}while(!stopping);}finally{clearInterval(heartbeatTimer);await heartbeat('stopped');await closeDatabase();}
