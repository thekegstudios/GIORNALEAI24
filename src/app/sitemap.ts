import type { MetadataRoute } from 'next';
import { getNews } from '@/lib/store';
import { isIndexableArticle, siteUrl } from '@/lib/format';
import { categories, regions } from '@/lib/regions';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> { if (process.env.SITE_INDEXABLE !== 'true') return []; const news = (await getNews({ limit: 1000 })).filter(isIndexableArticle); const staticPaths = ['', '/metodo', '/fonti', '/regioni', '/correzioni']; const activeCategories = categories.filter(c => news.some(a => a.categories.includes(c.slug))).map(c => `/categoria/${c.slug}`); const activeRegions = regions.filter(r => news.some(a => a.region === r.slug)).map(r => `/regioni/${r.slug}`); return [...staticPaths, ...(news.length ? ['/italia', '/ultim-ora'] : []), ...activeCategories, ...activeRegions].map(path => ({ url: `${siteUrl}${path}`, changeFrequency: 'daily' as const, priority: path === '' ? 1 : .5 })).concat(news.map(a => ({ url: `${siteUrl}/notizie/${a.slug}`, lastModified: new Date(a.updatedAt), changeFrequency: 'daily' as const, priority: .7 }))); }
