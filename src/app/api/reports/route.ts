import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { initDatabase, execute, query } from '@/lib/db';
import { sameOrigin, rateLimit, readJson } from '@/lib/security';
export const runtime = 'nodejs';
const schema = z.object({ kind: z.enum(['tip', 'correction']), articleId: z.string().max(100).optional(), message: z.string().min(30).max(4000), email: z.union([z.email(), z.literal('')]).optional(), website: z.string().max(300).optional() });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non consentita.' }, { status: 403 });
  try {
    const data = schema.parse(await readJson(request, 12_000));
    if (data.website) return NextResponse.json({ ok: true });
    if (!await rateLimit(request, 'reports', 5, 60 * 60_000)) return NextResponse.json({ error: 'Limite di segnalazioni raggiunto. Riprova più tardi.' }, { status: 429 });
    await initDatabase();
    await execute('DELETE FROM reports WHERE created_at < ?', [new Date(Date.now() - 90 * 86400_000).toISOString()]);
    await execute('INSERT INTO reports (id, kind, article_id, message, email, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), data.kind, data.articleId || null, data.message, data.email || null, new Date().toISOString(), 'review']);
    return NextResponse.json({ ok: true, message: 'Segnalazione ricevuta e inviata alla moderazione.' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Controlla il messaggio (30–4000 caratteri) e i dati inseriti.' }, { status: 400 }); }
}
