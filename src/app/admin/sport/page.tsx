import { cookies } from 'next/headers';
import Link from 'next/link';
import { SESSION_COOKIE,validSession } from '@/lib/auth';
import { getSportsOverview } from '@/lib/sports/store';
import { SportsAdmin } from '@/components/sports-admin';
import '../../sport/sports.css';
export const dynamic='force-dynamic';
export default async function SportsAdminPage(){if(!validSession((await cookies()).get(SESSION_COOKIE)?.value))return <section className="sports-admin"><h1>Accesso richiesto</h1><p>Il controllo sportivo usa la sessione amministrativa della redazione.</p><Link href="/admin">Accedi al pannello →</Link></section>;return <><p className="container"><Link href="/admin">← Redazione AI24</Link></p><SportsAdmin initial={await getSportsOverview()}/></>;}
