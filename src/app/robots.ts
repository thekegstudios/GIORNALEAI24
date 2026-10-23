import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/format';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots { const allowed = process.env.SITE_INDEXABLE === 'true'; return { rules: allowed ? { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/cerca', '/la-mia-italia', '/segnala', '/legale/'] } : { userAgent: '*', disallow: '/' }, ...(allowed ? { sitemap: `${siteUrl}/sitemap.xml` } : {}) }; }
