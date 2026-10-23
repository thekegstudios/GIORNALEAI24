import { isIndexableArticle } from '@/lib/format';
import { getNews } from '@/lib/store';
import { NewsGrid, PageIntro } from '@/components/news';
export async function generateMetadata() { const news = await getNews(); return { title: 'Italia', alternates: { canonical: '/italia' }, robots: { index: process.env.SITE_INDEXABLE === 'true' && news.some(isIndexableArticle), follow: true } }; }
export default async function ItalyPage() { const news = await getNews(); const ordered = [...news].sort((a, b) => b.relevance - a.relevance); return <div className="wrap page"><PageIntro eyebrow="LO SGUARDO D’INSIEME" title="L’Italia, adesso" description="Le notizie in ordine di rilevanza. Tutto quello che pubblichiamo parte da informazioni documentate." /><NewsGrid articles={ordered} /></div>; }


