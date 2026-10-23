import { runSportsCycle } from '../src/lib/sports/sync';
import { closeDatabase } from '../src/lib/db';
let stopped=false;process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
console.log('AI24 SPORT: worker indipendente, letture condivise e quote persistenti.');
let previous='';
while(!stopped){try{const result=await runSportsCycle();const summary=JSON.stringify(result);if(summary!==previous||result.requests){console.log(new Date().toISOString(),summary);previous=summary;}}catch{console.error('AI24 SPORT: ciclo non riuscito; nuovo tentativo tra 60 secondi.');}for(let second=0;second<60&&!stopped;second++)await new Promise(resolve=>setTimeout(resolve,1000));}
await closeDatabase();
