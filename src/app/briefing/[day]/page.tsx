import { notFound } from 'next/navigation';
import { BriefingPageContent } from '@/components/briefing-page';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Archivio AI24 Briefing', robots: { index: false, follow: true } };
export default async function DatedBriefingPage({ params, searchParams }: { params: Promise<{ day: string }>; searchParams: Promise<{ version?: string }> }) {
  const { day } = await params, search = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`))) notFound();
  return <BriefingPageContent day={day} version={search.version ? Number(search.version) : undefined} />;
}
