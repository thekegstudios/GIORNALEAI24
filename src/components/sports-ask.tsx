'use client';
import { openArticleAssistant } from './article-ai-context';
export function SportsAsk({eventId}:{eventId:string}){return <button className="sports-button" onClick={()=>openArticleAssistant({question:'Spiegami questo incontro usando i dati disponibili e indica quando sono stati aggiornati.',sportEventId:eventId})}>Chiedi ad AI24 su questo incontro</button>;}
