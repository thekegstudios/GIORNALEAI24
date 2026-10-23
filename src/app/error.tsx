'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="wrap not-found"><h1>Una pausa imprevista.</h1><p>Non è stato possibile caricare questo contenuto. Puoi riprovare tra poco.</p><div className="button-row" style={{ justifyContent: 'center', marginTop: 25 }}><button className="button" onClick={reset}>Riprova</button><Link className="button button-outline" href="/">Torna alla homepage</Link></div></div>; }
