import { NextResponse } from 'next/server';
import { getSportsEvent } from '@/lib/sports/store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(id.length>150)return NextResponse.json({error:'Identificativo non valido.'},{status:400});const event=await getSportsEvent(id);return event?NextResponse.json(event,{headers:{'Cache-Control':'public, max-age=30'}}):NextResponse.json({error:'Incontro non disponibile.'},{status:404});}
