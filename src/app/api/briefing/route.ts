import { NextResponse } from 'next/server';
import { getBriefingArchive, getBriefingHomeData, getPublicBriefing } from '@/lib/briefing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams, date = search.get('date') || undefined, versionText = search.get('version'), version = versionText ? Number(versionText) : undefined;
  const headers = { 'Cache-Control': 'no-store' };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date) || version !== undefined && (!date || !Number.isInteger(version) || version < 1)) return NextResponse.json({ error: 'Data o versione non valida.' }, { status: 400, headers });
  if (search.get('archive') === '1') return NextResponse.json({ editions: await getBriefingArchive() }, { headers });
  if (date) return NextResponse.json({ briefing: await getPublicBriefing(date, version) }, { headers });
  return NextResponse.json(await getBriefingHomeData(), { headers });
}
