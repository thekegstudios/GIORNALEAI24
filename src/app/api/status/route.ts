import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET() {
  const status = await getStatus();
  return NextResponse.json({ activeSources: status.activeSources, totalPublished: status.totalPublished, paused: status.paused, intervalMinutes: status.intervalMinutes, lastCheckedAt: status.lastRun?.finishedAt || null, lastRunStatus: status.lastRun?.status || null }, { headers: { 'Cache-Control': 'no-store' } });
}
