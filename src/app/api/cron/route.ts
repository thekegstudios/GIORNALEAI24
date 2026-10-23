import { NextResponse } from 'next/server';
import { equalSecret } from '@/lib/auth';
import { runNewsroomCycle } from '@/lib/orchestrator';
import { dispatchNetlifyJob } from '@/lib/netlify-jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request) {
  const key = process.env.CRON_SECRET || '';
  if (key.length < 32 || !equalSecret(request.headers.get('authorization') || '', `Bearer ${key}`)) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 401 });
  if (process.env.NETLIFY === 'true') {
    const queued = await dispatchNetlifyJob('news');
    return NextResponse.json({ queued: queued.status === 'accepted', status: queued.status }, { status: queued.status === 'accepted' ? 202 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(await runNewsroomCycle(), { headers: { 'Cache-Control': 'no-store' } });
}
