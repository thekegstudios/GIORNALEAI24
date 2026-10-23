import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export const SESSION_COOKIE = 'italiaora_admin';
const SESSION_SECONDS = 8 * 60 * 60;
function secret() {
  const value = process.env.SESSION_SECRET ?? '';
  if (value.length < 32) throw new Error('SESSION_SECRET non configurato (almeno 32 caratteri).');
  return value;
}
export function adminConfigured() {
  return (process.env.ADMIN_PASSWORD?.length ?? 0) >= 24 && (process.env.SESSION_SECRET?.length ?? 0) >= 32;
}
export function equalSecret(actual: string, expected: string) {
  const a = createHmac('sha256', 'constant-time-comparison').update(actual).digest();
  const b = createHmac('sha256', 'constant-time-comparison').update(expected).digest();
  return timingSafeEqual(a, b);
}
export function verifyCredentials(username: string, password: string) {
  if (!adminConfigured()) return false;
  const usernameOk = equalSecret(username, process.env.ADMIN_USERNAME || 'redazione');
  const salt = 'italia-ora-admin-v1';
  const actual = scryptSync(password.slice(0, 1024), salt, 64);
  const expected = scryptSync(process.env.ADMIN_PASSWORD!, salt, 64);
  return timingSafeEqual(actual, expected) && usernameOk;
}
export function createSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
export function validSession(token: string | undefined, now = Date.now()) {
  if (!token || !adminConfigured()) return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra || !payload || !signature) return false;
    const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
    if (!equalSecret(signature, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.exp === 'number' && data.exp > Math.floor(now / 1000) && data.exp <= Math.floor(now / 1000) + SESSION_SECONDS;
  } catch { return false; }
}
export function cookieOptions() {
  return { httpOnly: true, secure: (process.env.SITE_URL || '').startsWith('https://'), sameSite: 'strict' as const, path: '/', maxAge: SESSION_SECONDS };
}
