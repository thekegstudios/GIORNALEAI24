import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerWithContext } from '@/lib/chat';
import type { ChatContext, ChatStreamEvent } from '@/lib/newsroom-types';
import { answerSportsQuestion } from '@/lib/sports/chat';
import { answerPublicServiceQuestion } from '@/lib/public-service-chat';
import { rateLimit, readJson, sameOrigin } from '@/lib/security';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const schema=z.object({question:z.string().trim().min(5).max(500),articleId:z.string().min(1).max(100).optional(),articleSlug:z.string().min(1).max(250).regex(/^[a-zA-Z0-9-]+$/).optional(),articleIds:z.array(z.string().min(1).max(100)).min(1).max(6).optional(),sportEventId:z.string().min(1).max(100).optional(),stream:z.boolean().optional()}).strict();
const headers={'Cache-Control':'no-store'};
const limit=(name:string,fallback:number,max:number)=>{const value=Number(process.env[name]);return Number.isSafeInteger(value)&&value>0?Math.min(value,max):fallback;};
async function reply(question:string,context:ChatContext,options:{signal:AbortSignal;emit?:(event:ChatStreamEvent)=>void}){
  options.signal.throwIfAborted();
  if(context.sportEventId||!context.articleId&&!context.articleSlug&&!context.articleIds?.length&&/\b(risultati|classifica|punteggio|serie a|champions league|formula 1|motogp|nba|gioca|giocato)\b/i.test(question))return answerSportsQuestion(question,context.sportEventId);
  if(!context.articleId&&!context.articleSlug&&!context.articleIds?.length){const dataAnswer=await answerPublicServiceQuestion(question);if(dataAnswer)return dataAnswer;}
  return answerWithContext(question,context,options);
}
export async function POST(request:Request){
  if(!sameOrigin(request))return NextResponse.json({error:'Origine non consentita.'},{status:403,headers});
  try{
    if(!await rateLimit(request,'public-chat',limit('CHAT_REQUESTS_PER_WINDOW',15,100),limit('CHAT_RATE_WINDOW_SECONDS',600,3600)*1000))return NextResponse.json({error:'Limite di domande raggiunto. Riprova più tardi.'},{status:429,headers});
    const data=schema.parse(await readJson(request,4096));
    const context={articleId:data.articleId,articleSlug:data.articleSlug,articleIds:data.articleIds,sportEventId:data.sportEventId};
    if(!data.stream)return NextResponse.json(await reply(data.question,context,{signal:request.signal}),{headers});
    const cancellation=new AbortController();
    const signal=AbortSignal.any([request.signal,cancellation.signal]);
    const encoder=new TextEncoder();
    const stream=new ReadableStream<Uint8Array>({
      start(controller){
        const emit=(event:ChatStreamEvent)=>{if(!signal.aborted)controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));};
        void (async()=>{
          try{
            const response=await reply(data.question,context,{emit,signal});
            emit({type:'done',response});
          }catch{
            emit({type:'error',error:'Assistente temporaneamente non disponibile. Riprova più tardi.'});
          }finally{try{controller.close();}catch{/* The reader may have stopped the response. */}}
        })();
      },
      cancel(){cancellation.abort();},
    });
    return new Response(stream,{headers:{...headers,'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:'Inserisci una domanda da 5 a 500 caratteri.'},{status:400,headers});
    if(error instanceof SyntaxError||error instanceof Error&&['Richiesta JSON necessaria.','Richiesta vuota.','Richiesta troppo grande.'].includes(error.message))return NextResponse.json({error:'Invia una richiesta JSON valida entro 4 KB.'},{status:400,headers});
    return NextResponse.json({error:'Archivio temporaneamente non disponibile. Riprova più tardi.'},{status:503,headers});
  }
}
