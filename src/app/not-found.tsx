import Link from 'next/link';
export default function NotFound() { return <div className="wrap not-found"><span>404</span><h1>Qui non c’è una notizia.</h1><p>La pagina potrebbe essere stata rimossa, ritirata o spostata.</p><Link href="/" className="button">Torna alla prima pagina →</Link></div>; }
