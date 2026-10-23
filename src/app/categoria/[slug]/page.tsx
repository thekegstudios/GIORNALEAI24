import { isIndexableArticle } from '@/lib/format';
import { notFound } from 'next/navigation';
import { getNews } from '@/lib/store';
import { categories } from '@/lib/regions';
import { NewsGrid, PageIntro } from '@/components/news';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const category = categories.find(c => c.slug === slug); const news = await getNews({ category: slug }); return { title: category?.name || 'Categoria', alternates: { canonical: `/categoria/${slug}` }, robots: { index: process.env.SITE_INDEXABLE === 'true' && news.some(isIndexableArticle), follow: true } }; }
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const category = categories.find(c => c.slug === slug); if (!category) notFound(); const news = await getNews({ category: slug }); return <div className="wrap page"><PageIntro eyebrow="LE NOTIZIE, PER ARGOMENTO" title={category.name} description="Le informazioni disponibili dalle fonti autorizzate, con collegamenti agli originali e aggiornamenti trasparenti." /><NewsGrid articles={news} /></div>; }


