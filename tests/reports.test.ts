import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.SITE_URL = 'https://example.test';
const { POST } = await import('../src/app/api/reports/route');
const { query, closeDatabase } = await import('../src/lib/db');
after(closeDatabase);
function request(body: unknown, origin = 'https://example.test') {
  return new Request('https://example.test/api/reports', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
test('citizen submissions remain private and do not create published news', async () => {
  const response = await POST(request({ kind: 'tip', message: 'TEST DI MODERAZIONE: documento da esaminare solo nel database isolato.' }));
  assert.equal(response.status, 201);
  const reports = await query('SELECT status FROM reports');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 'review');
  assert.equal((await query('SELECT id FROM events')).length, 0);
});
test('report anti-abuse rejects foreign Origin and silently discards honeypot submissions', async () => {
  const foreign = await POST(request({ kind: 'tip', message: 'Questo messaggio non deve essere memorizzato.' }, 'https://evil.test'));
  assert.equal(foreign.status, 403);
  const honey = await POST(request({ kind: 'tip', message: 'Questo messaggio di spam non deve essere salvato.', website: 'https://spam.test' }));
  assert.equal(honey.status, 200);
  assert.equal((await query('SELECT id FROM reports')).length, 1);
});
