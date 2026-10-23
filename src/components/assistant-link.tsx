'use client';
import { MessageCircle,Sparkles } from 'lucide-react';
import { openArticleAssistant } from './article-ai-context';
export function AssistantLink({question='Quali sono le principali notizie italiane disponibili?',label='Chiedi ad AI24',outline=false}:{question?:string;label?:string;outline?:boolean}){return <button className={`button ${outline?'button-outline':''}`} onClick={()=>openArticleAssistant({question})}>{outline?<Sparkles size={16}/>:<MessageCircle size={17}/>} {label}</button>;}
