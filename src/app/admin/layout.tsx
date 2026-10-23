import Link from 'next/link';
import { cookies } from 'next/headers';
import { SESSION_COOKIE,validSession } from '@/lib/auth';
export default async function AdminLayout({children}:{children:React.ReactNode}){const allowed=validSession((await cookies()).get(SESSION_COOKIE)?.value);return <>{allowed&&<nav className="wrap admin-section-links" aria-label="Moduli amministrativi"><Link href="/admin">Redazione</Link><Link href="/admin/briefing">Briefing</Link><Link href="/admin/sport">Sport</Link><Link href="/admin/servizi-civici">Servizi civici</Link><Link href="/admin/autocontrollo">Autocontrollo</Link></nav>}{children}</>;}
