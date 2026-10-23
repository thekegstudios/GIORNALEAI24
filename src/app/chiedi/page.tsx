import { PageIntro } from '@/components/news';
import { ChatPanel } from '@/components/chat-panel';
export const metadata = { title: 'Chiedi a GIORNALE AI24', robots: { index: false, follow: true } };
export default async function AskPage({ searchParams }: { searchParams: Promise<{ articolo?: string }> }) { const { articolo } = await searchParams; return <div className="wrap page"><PageIntro eyebrow="LE TUE DOMANDE, I FATTI DISPONIBILI" title="Chiedi a GIORNALE AI24" description="Un modo più diretto per esplorare le notizie pubblicate, ricostruire il contesto e ritrovare le fonti. Gratuito, senza account." /><ChatPanel articleId={typeof articolo === 'string' ? articolo.slice(0, 100) : undefined} /></div>; }
