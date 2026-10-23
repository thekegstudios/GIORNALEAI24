import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE,validSession } from '@/lib/auth';
import { readJson,sameOrigin } from '@/lib/security';
import { getNewsroomOverview } from '@/lib/newsroom';
import { updateSettings } from '@/lib/store';
import { retryJob } from '@/lib/queue';
import { resolveIncident } from '@/lib/monitor';
import { rebuildHomepageEdition,setHomepageOverride } from '@/lib/homepage';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const settings=z.object({paused:z.boolean().optional(),safetyMode:z.boolean().optional(),chatEnabled:z.boolean().optional(),dailyBudgetUsd:z.number().min(0).max(100).optional(),monthlyBudgetUsd:z.number().min(0).max(3000).optional(),chatDailyBudgetUsd:z.number().min(0).max(10).optional(),intervalMinutes:z.number().int().min(5).max(1440).optional(),maxItemsPerRun:z.number().int().min(1).max(25).optional(),autoPublish:z.boolean().optional()}).strict();
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('settings'),settings}).strict(),
  z.object({action:z.literal('retry'),id:z.string().max(100)}).strict(),
  z.object({action:z.literal('resolve-incident'),id:z.string().max(100)}).strict(),
  z.object({action:z.literal('homepage'),articleId:z.string().max(100),position:z.number().int().min(1).max(12).nullable(),excluded:z.boolean(),reason:z.string().trim().min(10).max(1000)}).strict(),
  z.object({action:z.literal('rebuild-homepage')}).strict()
]);
async function authorized(){return validSession((await cookies()).get(SESSION_COOKIE)?.value);}
export async function GET(){if(!await authorized())return NextResponse.json({error:'Accesso richiesto.'},{status:401});return NextResponse.json(await getNewsroomOverview(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
  if(!await authorized())return NextResponse.json({error:'Accesso richiesto.'},{status:401});
  if(!sameOrigin(request))return NextResponse.json({error:'Origine non consentita.'},{status:403});
  try{
    const data=command.parse(await readJson(request));
    switch(data.action){
      case 'settings':await updateSettings(data.settings);break;
      case 'retry':await retryJob(data.id);break;
      case 'resolve-incident':await resolveIncident(data.id);break;
      case 'homepage':await setHomepageOverride(data);break;
      case 'rebuild-homepage':await rebuildHomepageEdition();break;
    }
    return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Dati non validi.':error instanceof Error?error.message:'Operazione non riuscita.'},{status:400});}
}
