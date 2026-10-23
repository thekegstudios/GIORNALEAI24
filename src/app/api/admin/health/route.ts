import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, equalSecret, validSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getServiceHealth, getWatchdogHistory } from '@/lib/service-health';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const expected = process.env.HEALTHCHECK_SECRET || process.env.CRON_SECRET, actual = request.headers.get('authorization') || '';
  const bearer = Boolean(expected && expected.length >= 32 && equalSecret(actual, `Bearer ${expected}`));
  if (!bearer && !validSession((await cookies()).get(SESSION_COOKIE)?.value)) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401, headers });
  if (new URL(request.url).searchParams.get('probe') === '1') {
    try { await query('SELECT 1 AS reachable'); return NextResponse.json({ database: 'reachable', checkedAt: new Date().toISOString() }, { headers }); }
    catch { return NextResponse.json({ database: 'unreachable' }, { status: 503, headers }); }
  }
  const snapshot = await getServiceHealth();
  return NextResponse.json({ ...snapshot, history: await getWatchdogHistory() }, { status: snapshot.checks.some(check => check.id === 'database' && check.state === 'error') ? 503 : 200, headers });
}
