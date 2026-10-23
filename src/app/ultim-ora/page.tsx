import { isIndexableArticle } from '@/lib/format';
import { getNews } from '@/lib/store';
import { NewsGrid, PageIntro } from '@/components/news';
export async function generateMetadata() { const news = await getNews(); return { title: 'Ultim’ora', alternates: { canonical: '/ultim-ora' }, robots: { index: process.env.SITE_INDEXABLE === 'true' && news.some(isIndexableArticle), follow: true } }; }
export default async function LatestPage() { const news = await getNews(); const ordered = [...news].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()); return <div className="wrap page"><PageIntro eyebrow="IN ORDINE DI PUBBLICAZIONE" title="Ultim’ora" description="Gli ultimi contenuti pubblicati. Questa pagina non costituisce una diretta: gli orari indicano la pubblicazione o l’aggiornamento dei singoli contenuti." /><NewsGrid articles={ordered} /></div>; }


