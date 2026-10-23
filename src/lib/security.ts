import { createHash } from 'node:crypto';
import { initDatabase, query } from './db';
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const allowed = new URL(process.env.SITE_URL || request.url).origin;
    return new URL(origin).origin === allowed;
  } catch { return false; }
}
export async function rateLimit(request: Request, scope: string, max: number, windowMs: number) {
  await initDatabase();
  // Without a trusted proxy header a single global bucket is intentionally conservative.
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const identity = header ? (request.headers.get(header) || 'unknown').slice(0, 128) : 'global';
  const key = createHash('sha256').update(`${scope}:${identity}`).digest('hex');
  const now = new Date().toISOString();
  const reset = new Date(Date.now() + windowMs).toISOString();
  const result = await query(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.count + 1 END,
    reset_at = CASE WHEN rate_limits.reset_at < ? THEN ? ELSE rate_limits.reset_at END
    RETURNING count`, [key, reset, now, now, reset]);
  return Number(result[0]?.count ?? max + 1) <= max;
}
export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('Richiesta JSON necessaria.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Richiesta vuota.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Richiesta troppo grande.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
