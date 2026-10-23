import Link from 'next/link';
import { getBriefingArchive } from '@/lib/briefing';
import { formatDate, fullDate } from '@/lib/format';
import '@/components/briefing.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Archivio dei briefing', robots: { index: false, follow: true } };
export default async function BriefingArchivePage() {
  const archive = await getBriefingArchive();
  return <div className="wrap page"><section className="briefing-archive"><span className="eyebrow">AI24 BRIEFING</span><h1>L’archivio, giorno per giorno.</h1><p>Le edizioni e le versioni effettivamente pubblicate. Le correzioni aggiungono una nuova versione con una motivazione; gli articoli ritirati non vengono riproposti come attuali.</p><form action="/briefing" method="get" className="briefing-date-form"><label htmlFor="briefing-date">Scegli una data<input type="date" id="briefing-date" name="date" required /></label><button className="button">Consulta il briefing</button></form>{archive.length > 0 ? <ul className="briefing-archive-list">{archive.map(entry => <li key={`${entry.day}:${entry.version}`}><Link href={`/briefing/${entry.day}?version=${entry.version}`}>{formatDate(`${entry.day}T12:00:00Z`)} · versione {entry.version}</Link><span>{entry.state === 'withdrawn' ? 'Edizione ritirata' : 'Pubblicata'} · {fullDate(entry.updatedAt)}</span></li>)}</ul> : <p>Nessun briefing è stato ancora pubblicato. L’archivio si popolerà con le edizioni reali.</p>}<Link href="/briefing" className="text-link">← Torna all’ultima edizione</Link></section></div>;
}
