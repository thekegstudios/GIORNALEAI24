import { cookies } from 'next/headers';
import Link from 'next/link';
import { SESSION_COOKIE, validSession } from '@/lib/auth';
import { getBriefingAdminData } from '@/lib/briefing';
import { BriefingAdmin } from '@/components/briefing-admin';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Control Center · Briefing', robots: { index: false, follow: false } };
export default async function BriefingAdminPage() {
  if (!validSession((await cookies()).get(SESSION_COOKIE)?.value)) return <div className="wrap page"><h1>Redazione AI24</h1><p>Accedi alla redazione per gestire AI24 Briefing.</p><Link className="button" href="/admin">Accedi alla redazione</Link></div>;
  return <div className="wrap page"><BriefingAdmin initial={await getBriefingAdminData()} /></div>;
}
