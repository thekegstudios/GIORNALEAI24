import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, validSession } from '@/lib/auth';
import { readJson, sameOrigin } from '@/lib/security';
import { getAdminData, updateSettings, setSourceEnabled, moderateArticle } from '@/lib/store';
import { runNewsroomCycle } from '@/lib/orchestrator';
import { isAIConfigured } from '@/lib/ai';
import { dispatchNetlifyJob } from '@/lib/netlify-jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const settings = z.object({ paused: z.boolean().optional(), intervalMinutes: z.number().int().min(5).max(1440).optional(), aiModel: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional(), dailyBudgetUsd: z.number().min(0).max(100).optional(), maxItemsPerRun: z.number().int().min(1).max(25).optional(), autoPublish: z.boolean().optional() });
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh') }),
  z.object({ action: z.literal('reprocess') }),
  z.object({ action: z.literal('settings'), settings }),
  z.object({ action: z.literal('source'), id: z.string().max(100), enabled: z.boolean() }),
  z.object({ action: z.literal('moderate'), id: z.string().max(100), operation: z.enum(['approve', 'reject', 'withdraw', 'correct']), title: z.string().min(12).max(240).optional(), summary: z.string().max(10_000).optional(), reason: z.string().min(10).max(2000),verified:z.boolean().optional() })
]);
async function authenticated() { return validSession((await cookies()).get(SESSION_COOKIE)?.value); }
export async function GET() {
  if (!await authenticated()) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401 });
  return NextResponse.json(await getAdminData(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (!await authenticated()) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non consentita.' }, { status: 403 });
  try {
    const data = schema.parse(await readJson(request));
    switch (data.action) {
      case 'refresh': {
        if (process.env.NETLIFY === 'true') {
          const queued = await dispatchNetlifyJob('news', { force: true });
          if (queued.status !== 'accepted') throw new Error('Aggiornamento background non disponibile. Verifica configurazione e abilitazione dei job Netlify.');
          return NextResponse.json({ ok: true, queued: true, message: 'Controllo delle fonti accodato. Consulta Esecuzioni e Autocontrollo per l’esito.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
        }
        return NextResponse.json({ ok: true, run: await runNewsroomCycle({ force: true }) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      case 'reprocess': {
        if (!isAIConfigured()) throw new Error('Configura OPENAI_API_KEY e le tariffe del modello sul server prima di elaborare le schede.');
        const current = (await getAdminData()).settings;
        if (current.aiModel !== (process.env.OPENAI_MODEL || 'gpt-4.1-mini')) throw new Error('Il modello selezionato non coincide con OPENAI_MODEL, cui si riferiscono le tariffe server.');
        if (process.env.NETLIFY === 'true') {
          const queued = await dispatchNetlifyJob('news', { reprocess: true });
          if (queued.status !== 'accepted') throw new Error('Elaborazione background non disponibile. Verifica configurazione e abilitazione dei job Netlify.');
          return NextResponse.json({ ok: true, queued: true, message: 'Elaborazione accodata. L’accettazione non conferma la pubblicazione: consulta Esecuzioni per l’esito.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
        }
        return NextResponse.json({ ok: true, run: await runNewsroomCycle({reprocess:true}) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      case 'settings': await updateSettings(data.settings); break;
      case 'source': await setSourceEnabled(data.id, data.enabled); break;
      case 'moderate': await moderateArticle(data.id, data.operation, { title: data.title, summary: data.summary, reason: data.reason,verified:data.verified }); break;
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? 'Dati non validi.' : error instanceof Error ? error.message : 'Operazione non riuscita.' }, { status: 400 });
  }
}
