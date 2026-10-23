import { getNews } from '@/lib/store';
import { PageIntro } from '@/components/news';
import { PersonalizedNews } from '@/components/preferences';
export const metadata = { title: 'La mia Italia', robots: { index: false, follow: true } };
export default async function MyItalyPage() { const news = await getNews(); return <div className="wrap page"><PageIntro eyebrow="IL TUO PUNTO DI VISTA" title="La mia Italia" description="La tua zona, i tuoi interessi e le storie che vuoi seguire. Nessun account: basta questo browser." /><PersonalizedNews articles={news} /></div>; }
