import { cookies } from 'next/headers';
import { SESSION_COOKIE, validSession, adminConfigured } from '@/lib/auth';
import { getAdminData } from '@/lib/store';
import { query } from '@/lib/db';
import { AdminDashboard, AdminLogin } from './ui';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Redazione · GIORNALE AI24', robots: { index: false, follow: false } };
export default async function AdminPage() {
  const authenticated = validSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!authenticated) return <AdminLogin configured={adminConfigured()} />;
  const data = await getAdminData();
  const reports = await query('SELECT id, kind, article_id, message, email, created_at, status FROM reports ORDER BY created_at DESC LIMIT 50');
  return <AdminDashboard initial={data} reports={reports as unknown as Report[]} />;
}
export interface Report { id: string; kind: string; article_id: string | null; message: string; email: string | null; created_at: string; status: string }
