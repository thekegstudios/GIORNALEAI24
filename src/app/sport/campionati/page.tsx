import Link from 'next/link';
import { competitionAuthorized,getCompetitions } from '@/lib/sports/store';
export const dynamic='force-dynamic';
export default async function Competitions(){const competitions=(await getCompetitions()).filter(competitionAuthorized);return <><h1>Campionati</h1><p>La disponibilità è confermata soltanto dopo un’importazione riuscita.</p>{competitions.length?<div className="sports-disciplines">{competitions.map(c=><Link href={`/sport/campionati/${c.id}`} key={c.id}><strong>{c.name}</strong><span>{c.country} · {c.season}</span><span>{c.coverageVerifiedAt?'Incontri importati':'In attesa di dati verificabili'}</span></Link>)}</div>:<div className="sports-empty">Nessun campionato è ancora abilitato con diritti di pubblicazione documentati.</div>}</>;}
