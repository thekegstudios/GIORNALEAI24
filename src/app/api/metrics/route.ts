import { NextResponse } from 'next/server';
import { sameOrigin, rateLimit, readJson } from '@/lib/security';
import { recordPublicPageView } from '@/lib/metrics';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (process.env.ANALYTICS_ENABLED !== 'true') return new NextResponse(null, { status: 204 });
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non consentita.' }, { status: 403 });
  if (!await rateLimit(request, 'aggregate-metrics', 1000, 60_000)) return new NextResponse(null, { status: 429 });
  try{const data=z.object({path:z.string().max(500),loadMs:z.number().min(0).max(60000).optional()}).strict().parse(await readJson(request,1024));await recordPublicPageView(data.path,data.loadMs);}catch{return new NextResponse(null,{status:400});}
  return new NextResponse(null, { status: 204 });
}
