import { isIndexableArticle } from '@/lib/format';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { regions } from '@/lib/regions';
import { getNews } from '@/lib/store';
import { NewsGrid, PageIntro } from '@/components/news';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const region = regions.find(r => r.slug === slug); const news = await getNews({ region: slug }); return { title: `Notizie ${region?.name || 'regione'}`, alternates: { canonical: `/regioni/${slug}` }, robots: { index: process.env.SITE_INDEXABLE === 'true' && news.some(isIndexableArticle), follow: true } }; }
export default async function RegionPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const region = regions.find(r => r.slug === slug); if (!region) notFound(); const news = await getNews({ region: slug }); return <div className="wrap page"><div className="breadcrumbs"><Link href="/regioni">Regioni</Link><span>/</span><span>{region.name}</span></div><PageIntro eyebrow="LA TUA ZONA" title={region.name} description={`Le notizie con un collegamento verificabile con ${region.name}. Quando non ci sono nuovi contenuti, lo diciamo apertamente.`} /><div className="page-actions"><Link className="button button-outline" href="/la-mia-italia">Personalizza la tua zona</Link></div><NewsGrid articles={news} /></div>; }


