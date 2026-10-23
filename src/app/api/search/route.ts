import { NextResponse } from 'next/server';
import { getNews } from '@/lib/store';
import { regions,categories } from '@/lib/regions';
import { getSportsEntities,getCompetitions,competitionAuthorized } from '@/lib/sports/store';
import { rateLimit } from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(!await rateLimit(request,'public-search',120,60_000))return NextResponse.json({items:[]},{status:429});
  const text=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,100),normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(text.length<2)return NextResponse.json({items:[]});
  const needle=normalize(text),news=await getNews({query:text,limit:5});
  const destinations=[...regions.map(region=>({label:region.name,url:`/regioni/${region.slug}`,kind:'Regione'})),...categories.map(category=>({label:category.name,url:`/categoria/${category.slug}`,kind:'Categoria'})),...([{label:'Carburanti vicino a te',url:'/carburanti',kind:'Strumento'},{label:'La Guerra Silenziosa',url:'/guerra-silenziosa',kind:'Rubrica'},{label:'Italia in numeri',url:'/italia-in-numeri',kind:'Dati'},{label:'AI24 Briefing',url:'/briefing',kind:'Briefing'},{label:'Il mio Comune',url:'/il-mio-comune',kind:'Territorio'}])].filter(item=>normalize(item.label).includes(needle));
  const [entities,competitions]=await Promise.all([getSportsEntities(),getCompetitions()]);
  const sports=[...entities.filter(entity=>normalize(entity.name).includes(needle)).map(entity=>({label:entity.name,url:`/sport/${entity.kind==='athlete'?'atleti':'squadre'}/${encodeURIComponent(entity.id)}`,kind:'Sport'})),...competitions.filter(competition=>competitionAuthorized(competition)&&normalize(competition.name).includes(needle)).map(competition=>({label:competition.name,url:`/sport/campionati/${competition.id}`,kind:'Campionato'}))].slice(0,3);
  return NextResponse.json({items:[...news.map(article=>({label:article.title,url:`/notizie/${article.slug}`,kind:'Notizia'})),...destinations,...sports].slice(0,9)},{headers:{'Cache-Control':'no-store'}});
}
