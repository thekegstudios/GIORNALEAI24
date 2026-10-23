import { cookies } from 'next/headers';
import Link from 'next/link';
import { SESSION_COOKIE, validSession } from '@/lib/auth';
import { getServiceHealth, getWatchdogHistory } from '@/lib/service-health';
import { ServiceHealthPanel } from '@/components/service-health';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI24 Autocontrollo · Redazione', robots: { index: false, follow: false } };
export default async function AutocontrolloPage() {
  if (!validSession((await cookies()).get(SESSION_COOKIE)?.value)) return <div className="wrap page"><h1>AI24 Autocontrollo</h1><p>Accedi alla redazione per consultare la salute dei servizi.</p><Link className="button" href="/admin">Accedi alla redazione</Link></div>;
  const [snapshot, history] = await Promise.all([getServiceHealth(), getWatchdogHistory()]);
  return <div className="wrap page"><ServiceHealthPanel initial={{ ...snapshot, history }} /></div>;
}
