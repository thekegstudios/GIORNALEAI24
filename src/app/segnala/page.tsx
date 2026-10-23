import Link from 'next/link';
import { PageIntro } from '@/components/news';
import { ReportForm } from '@/components/report-form';
export const metadata = { title: 'Segnala una notizia o un errore', robots: { index: false, follow: true } };
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ articolo?: string }> }) { const { articolo } = await searchParams; return <div className="wrap page"><PageIntro eyebrow="IL TUO CONTRIBUTO CONTA" title="Hai qualcosa da segnalarci?" description="Una notizia di interesse pubblico, un documento utile o un errore da correggere. Il contributo entra in una coda di moderazione e non viene pubblicato automaticamente." /><ReportForm articleId={articolo?.slice(0, 100)} /><p className="small-muted" style={{ marginTop: 23 }}>Per informazioni sul trattamento dei dati, consulta la <Link className="text-link" href="/legale/privacy">bozza di informativa privacy</Link>. Il modulo non è un servizio di emergenza.</p></div>; }
