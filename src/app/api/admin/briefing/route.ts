import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, validSession } from '@/lib/auth';
import { rateLimit, readJson, sameOrigin } from '@/lib/security';
import { briefingSettingsSchema, getBriefingAdminData, moderateBriefing, runBriefingCycle, updateBriefingSettings } from '@/lib/briefing';
import { logAction } from '@/lib/audit';
import { dispatchNetlifyJob } from '@/lib/netlify-jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reason = z.string().trim().min(10).max(1000), id = z.string().min(1).max(100);
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), reason }).strict(),
  z.object({ action: z.literal('approve'), id, reason }).strict(),
  z.object({ action: z.literal('correct'), id, reason, summary: z.string().trim().min(20).max(7000) }).strict(),
  z.object({ action: z.literal('withdraw'), id, reason }).strict(),
  z.object({ action: z.literal('settings'), settings: briefingSettingsSchema, reason }).strict(),
]);
const headers = { 'Cache-Control': 'no-store' };
async function authorized() { return validSession((await cookies()).get(SESSION_COOKIE)?.value); }
export async function GET() {
  if (!await authorized()) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401, headers });
  return NextResponse.json(await getBriefingAdminData(), { headers });
}
export async function POST(request: Request) {
  if (!await authorized()) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401, headers });
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non consentita.' }, { status: 403, headers });
  if (!await rateLimit(request, 'admin-briefing', 30, 60_000)) return NextResponse.json({ error: 'Troppe operazioni; riprova tra un minuto.' }, { status: 429, headers });
  try {
    const data = command.parse(await readJson(request, 12_288));
    if (data.action === 'settings') await updateBriefingSettings(data.settings, data.reason);
    else if (data.action === 'generate') {
      if (!await rateLimit(request, 'admin-briefing-generation', 3, 60_000)) return NextResponse.json({ error: 'Limite di generazione raggiunto; attendi un minuto.' }, { status: 429, headers });
      await logAction('chief', 'briefing-generation-requested', null, { reason: data.reason, actor: 'administrator' });
      if (process.env.NETLIFY === 'true') {
        const queued = await dispatchNetlifyJob('briefing', { force: true, reason: data.reason });
        if (queued.status !== 'accepted') throw new Error('Generazione background non disponibile. Verifica configurazione e abilitazione dei job Netlify.');
        return NextResponse.json({ ok: true, queued: true, message: 'Generazione accodata. Ricarica il pannello per verificare l’esito e l’eventuale bozza da revisionare.', data: await getBriefingAdminData() }, { status: 202, headers });
      }
      const result = await runBriefingCycle({ force: true, reason: data.reason });
      return NextResponse.json({ ok: result.state !== 'failed', result, data: await getBriefingAdminData() }, { status: result.state === 'failed' ? 400 : 200, headers });
    } else await moderateBriefing(data.id, data.action, data.reason, data.action === 'correct' ? data.summary : undefined);
    return NextResponse.json({ ok: true, data: await getBriefingAdminData() }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? 'Dati non validi.' : error instanceof Error ? error.message : 'Operazione non riuscita.' }, { status: 400, headers });
  }
}
