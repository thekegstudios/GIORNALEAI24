import type { Metadata } from 'next';
import { Header, Footer, PreferencesNotice } from '@/components/chrome';
import { Analytics } from '@/components/analytics';
import { Intro } from '@/components/intro';
import { FloatingAssistant } from '@/components/floating-assistant';
import { PWASupport } from '@/components/pwa-support';
import { getStatus, getSources } from '@/lib/store';
import { siteUrl } from '@/lib/format';
import './globals.css';
import './portal.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { metadataBase: new URL(siteUrl), title: { default: 'GIORNALE AI24 — Capire l’Italia, adesso.', template: '%s | GIORNALE AI24' }, description: 'Notizie dall’Italia, fonti trasparenti e contesto. Un progetto gratuito di KEG Studios con il supporto dell’intelligenza artificiale.', robots: { index: process.env.SITE_INDEXABLE === 'true', follow: true }, openGraph: { siteName: 'GIORNALE AI24', locale: 'it_IT', type: 'website' }, twitter: { card: 'summary_large_image' } };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, sources] = await Promise.all([getStatus(), getSources()]);
  const checkedAt = sources.map(source => source.lastCheckedAt).filter((value): value is string => Boolean(value)).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
  return <html lang="it" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('italia-ora-theme')==='light'?'light':'dark'}catch(e){}" }} /></head><body><Intro /><a className="skip-link" href="#main-content">Vai al contenuto</a><Header checkedAt={checkedAt} activeSources={status.activeSources} /><main id="main-content">{children}</main><Footer /><PreferencesNotice /><FloatingAssistant/><PWASupport/><Analytics enabled={process.env.ANALYTICS_ENABLED === 'true'} /></body></html>;
}
