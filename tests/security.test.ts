import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USERNAME = 'editor-test';
process.env.ADMIN_PASSWORD = 'test-only-password-which-is-long-enough';
process.env.SESSION_SECRET = 'test-only-session-secret-with-at-least-thirty-two-characters';
process.env.SITE_URL = 'https://example.test';
const { verifyCredentials, createSession, validSession, equalSecret, adminConfigured } = await import('../src/lib/auth');
const { sameOrigin, rateLimit, readJson } = await import('../src/lib/security');
const { closeDatabase } = await import('../src/lib/db');
after(async () => { await closeDatabase(); });
test('private administration rejects incorrect credentials, unsigned, tampered and expired sessions', () => {
  assert.equal(adminConfigured(), true);
  assert.equal(verifyCredentials('editor-test', process.env.ADMIN_PASSWORD!), true);
  assert.equal(verifyCredentials('other', process.env.ADMIN_PASSWORD!), false);
  assert.equal(verifyCredentials('editor-test', 'wrong'), false);
  const session = createSession();
  assert.equal(validSession(session), true);
  assert.equal(validSession(session + 'tampered'), false);
  assert.equal(validSession(session.replace(/^[^.]+/, Buffer.from('{"exp":99999999999}').toString('base64url'))), false);
  assert.equal(validSession(createSession(Date.now() - 9 * 3600_000)), false);
  assert.equal(validSession(undefined), false);
  assert.equal(equalSecret('', 'secret'), false);
});
test('mutating requests require exact configured Origin', () => {
  assert.equal(sameOrigin(new Request('https://example.test/api/admin', { headers: { origin: 'https://example.test' } })), true);
  assert.equal(sameOrigin(new Request('https://example.test/api/admin', { headers: { origin: 'https://evil.test' } })), false);
  assert.equal(sameOrigin(new Request('https://example.test/api/admin')), false);
});
test('database rate limit remains atomic under concurrent requests', async () => {
  const request = new Request('https://example.test/api/auth');
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => rateLimit(request, 'concurrency-test', 3, 60_000)));
  assert.equal(outcomes.filter(Boolean).length, 3);
});
test('JSON body limits reject oversize payloads before parsing', async () => {
  const valid = new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  assert.deepEqual(await readJson(valid, 20), { a: 1 });
  const tooLarge = new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(200) }) });
  await assert.rejects(readJson(tooLarge, 20), /troppo grande/);
});
