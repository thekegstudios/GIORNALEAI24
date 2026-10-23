import { cookies } from 'next/headers';
import Link from 'next/link';
import { SESSION_COOKIE,validSession } from '@/lib/auth';
import { getCivicOverview } from '@/lib/civic';
import { CivicAdmin } from '@/components/civic-admin';
import '@/components/civic.css';
export const dynamic='force-dynamic';
export default async function CivicAdministration(){if(!validSession((await cookies()).get(SESSION_COOKIE)?.value))return <section className="container civic-admin"><h1>Accesso richiesto</h1><Link href="/admin">Accedi alla redazione →</Link></section>;return <><p className="container"><Link href="/admin">← Redazione AI24</Link></p><CivicAdmin initial={await getCivicOverview()}/></>;}
