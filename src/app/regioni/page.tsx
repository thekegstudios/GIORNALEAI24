import Link from 'next/link';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { regions } from '@/lib/regions';
import { getNews } from '@/lib/store';
import { PageIntro } from '@/components/news';
export const metadata = { title: 'Notizie dalle regioni', alternates: { canonical: '/regioni' } };
export default async function RegionsPage() { const news = await getNews(); return <div className="wrap page"><PageIntro eyebrow="LA TUA ZONA" title="Venti regioni. La tua Italia." description="Scegli un territorio. Le notizie locali sono associate a una zona soltanto quando le fonti ne documentano il collegamento." /><div className="region-overview"><MapPin size={29} /><p>Una finestra sul tuo territorio, senza geolocalizzazione. Puoi salvare la tua scelta in <Link href="/la-mia-italia">La mia Italia</Link>.</p></div><div className="region-grid">{regions.map((r, i) => { const count = news.filter(a => a.region === r.slug).length; return <Link className="region-card" key={r.slug} href={`/regioni/${r.slug}`}><span className="region-number">{String(i + 1).padStart(2, '0')}</span><h2>{r.name}</h2><p>{count ? `${count} ${count === 1 ? 'notizia disponibile' : 'notizie disponibili'}` : 'Nessun aggiornamento verificato'}</p><ArrowUpRight size={20} /></Link>; })}</div></div>; }
