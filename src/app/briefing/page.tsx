import { BriefingPageContent } from '@/components/briefing-page';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI24 Briefing — L’Italia in 60 secondi', description: 'La selezione verificabile della Redazione AI24: lettura rapida, articoli e fonti originali.', alternates: { canonical: '/briefing' }, robots: { index: false, follow: true } };
export default async function BriefingPage({ searchParams }: { searchParams: Promise<{ date?: string; version?: string }> }) {
  const search = await searchParams;
  return <BriefingPageContent day={search.date} version={search.version ? Number(search.version) : undefined} />;
}
