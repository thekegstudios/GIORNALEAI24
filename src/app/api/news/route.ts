import { NextResponse } from 'next/server';
import { getNews } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const articles = await getNews({ category: p.get('category') || undefined, region: p.get('region') || undefined, query: (p.get('q') || '').slice(0, 150), limit: 100 });
  return NextResponse.json(articles, { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } });
}
