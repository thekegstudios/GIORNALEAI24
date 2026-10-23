import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE,validSession } from '@/lib/auth';
import { rateLimit,readJson,sameOrigin } from '@/lib/security';
import { getCivicOverview,measureInput,noticeInput,runCivicCycle,saveCivicMeasure,saveCivicNotice } from '@/lib/civic';
export const runtime='nodejs';export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[z.object({action:z.literal('notice'),notice:noticeInput}).strict(),z.object({action:z.literal('measure'),measure:measureInput}).strict(),z.object({action:z.literal('collect-public-articles')}).strict()]);
async function authorized(){return validSession((await cookies()).get(SESSION_COOKIE)?.value);}
export async function GET(){if(!await authorized())return NextResponse.json({error:'Accesso richiesto.'},{status:401});return NextResponse.json(await getCivicOverview(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){if(!await authorized())return NextResponse.json({error:'Accesso richiesto.'},{status:401});if(!sameOrigin(request))return NextResponse.json({error:'Origine non consentita.'},{status:403});if(!await rateLimit(request,'civic-admin',30,60000))return NextResponse.json({error:'Troppe operazioni.'},{status:429});try{const data=command.parse(await readJson(request,32768));if(data.action==='notice')await saveCivicNotice(data.notice);else if(data.action==='measure')await saveCivicMeasure(data.measure);else await runCivicCycle();return NextResponse.json({ok:true,overview:await getCivicOverview()},{headers:{'Cache-Control':'no-store'}});}catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Dati non validi: controlla date, testi e campi richiesti.':error instanceof Error?error.message:'Operazione non riuscita.'},{status:400});}}
