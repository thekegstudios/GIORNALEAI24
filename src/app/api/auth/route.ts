import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, adminConfigured, createSession, cookieOptions, verifyCredentials } from '@/lib/auth';
import { sameOrigin, rateLimit, readJson } from '@/lib/security';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non consentita.' }, { status: 403 });
  if (!adminConfigured()) return NextResponse.json({ error: 'Pannello disattivato: configurare le credenziali server.' }, { status: 503 });
  if (!await rateLimit(request, 'login', 8, 15 * 60_000)) return NextResponse.json({ error: 'Troppi tentativi. Riprova tra 15 minuti.' }, { status: 429 });
  try {
    const data = z.object({ username: z.string().max(100), password: z.string().max(1024) }).parse(await readJson(request, 4096));
    if (!verifyCredentials(data.username, data.password)) return NextResponse.json({ error: 'Credenziali non valide.' }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(SESSION_COOKIE, createSession(), cookieOptions());
    return response;
  } catch { return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non consentita.' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  return response;
}
