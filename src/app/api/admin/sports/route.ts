import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE,validSession } from '@/lib/auth';
import { rateLimit,readJson,sameOrigin } from '@/lib/security';
import { competitionInput,getSportsOverview,saveCompetition,saveDiscipline,saveProvider } from '@/lib/sports/store';
import { runSportsCycle } from '@/lib/sports/sync';
import { dispatchNetlifyJob } from '@/lib/netlify-jobs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('competition'),competition:competitionInput}).strict(),
 z.object({action:z.literal('discipline'),discipline:z.object({id:z.string().regex(/^[a-z0-9-]{1,80}$/),name:z.string().min(2).max(100),scoreKind:z.enum(['football','volleyball','basketball','tennis','race','other']),enabled:z.boolean()}).strict()}).strict(),
 z.object({action:z.literal('provider'),provider:z.object({id:z.literal('api-sports'),name:z.literal('API-SPORTS'),enabled:z.boolean(),dailyLimit:z.number().int().min(1).max(150000),minuteLimit:z.number().int().min(1).max(450),monthlyCostUsd:z.number().min(0).max(10000).nullable()}).strict()}).strict(),
 z.object({action:z.literal('sync')}).strict()
]);
async function authorized(){return validSession((await cookies()).get(SESSION_COOKIE)?.value);}
export async function GET(){if(!await authorized())return NextResponse.json({error:'Accesso richiesto.'},{status:401});return NextResponse.json(await getSportsOverview(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
  if(!await authorized())return NextResponse.json({error:'Accesso richiesto.'},{status:401});
  if(!sameOrigin(request))return NextResponse.json({error:'Origine non consentita.'},{status:403});
  if(!await rateLimit(request,'sports-admin',30,60000))return NextResponse.json({error:'Troppe operazioni.'},{status:429});
  try{
    const data=command.parse(await readJson(request,16384));
    if(data.action==='competition')await saveCompetition(data.competition);
    if(data.action==='discipline')await saveDiscipline(data.discipline);
    if(data.action==='provider')await saveProvider(data.provider);
    if(data.action==='sync'&&process.env.NETLIFY==='true'){
      const queued=await dispatchNetlifyJob('sports');
      if(queued.status!=='accepted')throw new Error('Sincronizzazione background non disponibile. Verifica configurazione e abilitazione dei job Netlify.');
      return NextResponse.json({ok:true,queued:true,message:'Sincronizzazione accodata. Ricarica il pannello per verificare l’esito.',overview:await getSportsOverview()},{status:202,headers:{'Cache-Control':'no-store'}});
    }
    const result=data.action==='sync'?await runSportsCycle():null;
    return NextResponse.json({ok:true,result,overview:await getSportsOverview()},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Dati non validi.':error instanceof Error?error.message:'Operazione non riuscita.'},{status:400});}
}
