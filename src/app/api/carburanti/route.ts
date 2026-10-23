import { NextResponse } from 'next/server';
import { z } from 'zod';
import { searchFuel,getFuelStatus,getFuelOptions,getFuelSummary,getFuelHistory } from '@/lib/fuel';
import { rateLimit } from '@/lib/security';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const number=(min:number,max:number)=>z.coerce.number().min(min).max(max).optional();
const schema=z.object({municipality:z.string().max(150).optional(),province:z.string().max(100).optional(),fuel:z.string().max(100).optional(),service:z.enum(['self','servito']).optional(),network:z.enum(['stradale','autostradale']).optional(),latitude:number(35,48),longitude:number(6,19),radiusKm:number(1,100),view:z.enum(['search','options','summary','history']).default('search')}).strict().refine(value=>(value.latitude===undefined)===(value.longitude===undefined),'Coordinate incomplete');
export async function GET(request:Request){
  const headers={'Cache-Control':'no-store'};
  if(!await rateLimit(request,'fuel-read',180,60_000))return NextResponse.json({error:'Troppe richieste. Riprova tra poco.'},{status:429,headers});
  try{const value=schema.parse(Object.fromEntries(new URL(request.url).searchParams));const status=await getFuelStatus();
    if(value.view==='options')return NextResponse.json({...await getFuelOptions(),status},{headers});
    if(value.view==='summary')return NextResponse.json({items:await getFuelSummary(),status},{headers});
    if(value.view==='history')return NextResponse.json({items:await getFuelHistory(value.fuel),status},{headers});
    return NextResponse.json({items:await searchFuel(value),status},{headers});
  }catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Filtri non validi.':'Dati carburanti temporaneamente non disponibili.'},{status:error instanceof z.ZodError?400:503,headers});}
}
