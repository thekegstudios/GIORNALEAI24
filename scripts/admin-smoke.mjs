import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const origin = new URL(base).origin;
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Questo test credenziali è limitato al server locale.');
assert(process.env.ADMIN_PASSWORD && process.env.ADMIN_USERNAME, 'Carica .env.local senza stampare le credenziali.');
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }) });
assert.equal(login.status, 200, 'Login amministratore');
const cookieHeader = login.headers.get('set-cookie');
assert(cookieHeader?.includes('HttpOnly') && cookieHeader.includes('SameSite=strict'), 'Cookie protetto');
const cookie = cookieHeader.split(';')[0];
const privateData = await fetch(`${base}/api/admin`, { headers: { cookie } });
assert.equal(privateData.status, 200);
assert.equal(privateData.headers.get('cache-control'), 'no-store');
const state = await privateData.json();
assert(Array.isArray(state.sources) && Array.isArray(state.articles));
const newsroom = await fetch(`${base}/api/newsroom`, { headers: { cookie } });
assert.equal(newsroom.status, 200, 'Pannello Redazione AI autenticato');
assert.equal(newsroom.headers.get('cache-control'), 'no-store');
const overview = await newsroom.json();
assert.equal(overview.modules.length, 9);
assert(Array.isArray(overview.queue.jobs) && Array.isArray(overview.actions));
assert.equal(typeof overview.budget.monthlyBudgetUsd, 'number');
assert.equal(overview.analytics.uniqueVisitors, null, 'Nessun visitatore unico inventato');
assert.equal(overview.analytics.adRevenue, null, 'Nessun ricavo inventato');
for(const path of ['/api/admin/briefing','/api/admin/civic','/api/admin/sports','/api/admin/health']){
  const response=await fetch(`${base}${path}`,{headers:{cookie}});
  assert.equal(response.status,200,`API protetta ${path}`);
  assert.equal(response.headers.get('cache-control'),'no-store');
  await response.json();
}
if (!overview.settings.chatEnabled) {
  const chat = await fetch(`${base}/api/chat`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Cosa sappiamo delle notizie ambiente in archivio?' }) });
  assert.equal(chat.status, 200, 'Chat archivio senza attivare AI');
  assert.equal(chat.headers.get('cache-control'), 'no-store');
  const answer = await chat.json();
  assert.equal(answer.mode, 'archive');
  assert(Array.isArray(answer.citations) && Array.isArray(answer.uncertainties));
}
const csrf = await fetch(`${base}/api/admin`, { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'settings', settings: { paused: true } }) });
assert.equal(csrf.status, 403, 'Origin estranea rifiutata senza modificare le impostazioni');
const logout = await fetch(`${base}/api/auth`, { method: 'DELETE', headers: { cookie, origin } });
assert.equal(logout.status, 200);
assert(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
console.log('Admin smoke PASS: login, cookie HttpOnly/SameSite, API Redazione AI e budget, chat archivio se AI disattivata, dati no-store, CSRF e logout. Nessuna decisione editoriale o impostazione modificata.');
