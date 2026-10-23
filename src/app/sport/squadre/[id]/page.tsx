import { notFound } from 'next/navigation';
import { getSportsEntities,getSportsEvents,getSportsStandings } from '@/lib/sports/store';
import { SportEventList,Standings } from '@/components/sports-ui';
import { SportFavoriteButton } from '@/components/sports-favorites';
import { getNews } from '@/lib/store';
import Link from 'next/link';
export const dynamic='force-dynamic';
export default async function EntityPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const entity=(await getSportsEntities()).find(e=>e.id===id);if(!entity)notFound();const [events,tables,news]=await Promise.all([getSportsEvents({entity:id}),getSportsStandings(),getNews({category:'sport',query:entity.name,limit:8})]);return <><span className="sports-eyebrow">{entity.kind==='athlete'?'ATLETA':'SQUADRA'} · {entity.sportId}</span><div className="sports-section-heading"><h1>{entity.name}</h1><SportFavoriteButton id={id} name={entity.name}/></div>{entity.country&&<p>Paese dichiarato dalla fonte: {entity.country}</p>}<h2>Prossimi incontri</h2><SportEventList events={events.filter(e=>e.status==='scheduled').sort((a,b)=>a.startsAt.localeCompare(b.startsAt))}/><h2>Ultimi risultati</h2><SportEventList events={events.filter(e=>e.status==='finished')}/><h2>Posizione in classifica</h2><Standings tables={tables.filter(t=>t.rows.some(r=>r.entityId===id))}/><h2>Notizie correlate</h2>{news.length?<ul>{news.map(a=><li key={a.id}><Link href={`/notizie/${a.slug}`}>{a.title}</Link></li>)}</ul>:<p>Nessuna notizia pubblicata corrispondente al nome del partecipante.</p>}</>;}
