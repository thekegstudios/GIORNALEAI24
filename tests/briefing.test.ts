import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_MODEL = 'gpt-4.1-mini';
process.env.AI_INPUT_USD_PER_MILLION = '0.5';
process.env.AI_OUTPUT_USD_PER_MILLION = '2';
const { closeDatabase, execute, query } = await import('../src/lib/db');
const { INITIAL_SOURCES } = await import('../src/lib/catalog');
const { updateSettings } = await import('../src/lib/store');
const { articleBriefingVersion, isBriefingEligible, selectBriefingItems, briefingIsDue, getBriefingSettings, runBriefingCycle, getPublicBriefing, reconcileBriefingsForArticle, getBriefingArchive, moderateBriefing, updateBriefingSettings, validateBriefingClaims } = await import('../src/lib/briefing');
const { composeBriefingLocalItems } = await import('../src/lib/briefing-personalization');
const { romeDate } = await import('../src/lib/budget');
const sourceMap = new Map(INITIAL_SOURCES.map(source => [source.id, source]));
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await closeDatabase(); });

function article(id: string, category: import('../src/lib/types').Category = 'ambiente', relevance = 70): import('../src/lib/types').Article {
  const at = new Date().toISOString(), url = `https://www.isprambiente.gov.it/it/notizie/test-isolato-${id}`;
  return { id, slug: id, title: `TEST ISOLATO ${id}: aggiornamento del documento pubblico`, summary: `Il documento pubblico di prova ${id} riporta un aggiornamento verificato. Il testo esiste soltanto nel database isolato del test.`, context: 'Contesto approvato nella fixture isolata.', categories: [category], region: null, province: null, municipality: null, locationEvidence: null, relevance, status: 'published', publishedAt: at, updatedAt: at, confirmed: [`Aggiornamento verificato ${id}.`], unconfirmed: [], explanations: { simple: '', detailed: '', causes: '', consequences: '', practical: '' }, citations: [{ sourceId: 'ispra', sourceName: 'ISPRA', url, title: id, publishedAt: at, checkedAt: at, license: 'CC BY 4.0', termsUrl: 'https://www.isprambiente.gov.it/it/note-legali' }], timeline: [], reviewReasons: [], aiGenerated: false, originalContent: true, verification: { status: 'CONFIRMED', checkedAt: at, explanation: 'Fixture con approvazione editoriale esplicita.', checks: [{ name: 'Verifica umana isolata', passed: true, detail: 'Solo test.' }], claims: [{ text: `Aggiornamento verificato ${id}.`, status: 'CONFIRMED', evidence: [{ sourceId: 'ispra', url, itemHash: id }] }], independentOrigins: 1, eventDate: null, eventDateEvidence: null, geography: { level: 'national', region: null, province: null, municipality: null, evidence: null } } };
}
async function insert(item: import('../src/lib/types').Article) {
  await execute('INSERT INTO events (id,slug,title,status,payload,published_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload', [item.id, item.slug, item.title, item.status, JSON.stringify(item), item.publishedAt, item.updatedAt]);
  for (const citation of item.citations) await execute('INSERT INTO link_checks (url,status,http_status,checked_at,error) VALUES (?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at', [citation.url, 'ok', 200, new Date().toISOString(), null]);
}
async function reset() {
  for (const table of ['ai24_briefing_audio', 'ai24_briefing_items', 'ai24_briefings', 'ai24_briefing_runs', 'editorial_reviews', 'events', 'link_checks', 'ai_usage_details', 'ai_usage']) await execute(`DELETE FROM ${table}`);
  process.env.OPENAI_API_KEY = '';
  await updateSettings({ paused: false, safetyMode: false, aiModel: 'gpt-4.1-mini', dailyBudgetUsd: 20, monthlyBudgetUsd: 200 });
}

test('briefing accepts verified original publications and rejects metadata, pending review, invalid evidence and old sources', () => {
  const item = article('eligibility');
  assert.equal(isBriefingEligible(item, sourceMap), true);
  assert.equal(isBriefingEligible({ ...item, originalContent: false }, sourceMap), false);
  assert.equal(isBriefingEligible({ ...item, status: 'review' }, sourceMap), false);
  assert.equal(isBriefingEligible(item, sourceMap, { pending: new Set([item.id]) }), false);
  assert.equal(isBriefingEligible({ ...item, verification: { ...item.verification!, status: 'DEVELOPING' } }, sourceMap), false);
  assert.equal(isBriefingEligible({ ...item, verification: { ...item.verification!, claims: [{ ...item.verification!.claims[0], evidence: [{ sourceId: 'ispra', url: 'https://outside.example/article', itemHash: 'outside' }] }] } }, sourceMap), false);
  assert.equal(isBriefingEligible({ ...item, citations: [{ ...item.citations[0], url: 'https://outside.example/article' }] }, sourceMap), false);
  assert.equal(isBriefingEligible({ ...item, citations: [{ ...item.citations[0], publishedAt: '2020-01-01T00:00:00Z' }] }, sourceMap), false);
  assert.equal(isBriefingEligible({ ...item, region: 'sicilia', locationEvidence: null }, sourceMap), false);
});
test('selection diversifies categories, deduplicates sources and uses fewer than five real eligible stories', () => {
  const a = article('selection-a', 'politica', 80), b = article('selection-b', 'politica', 79), c = article('selection-c', 'economia', 78);
  const selected = selectBriefingItems([a, b, c, { ...a, id: 'duplicate-reference', title: 'Un titolo diverso che riusa la stessa fonte' }], sourceMap);
  assert.equal(selected.length, 3); assert.equal(selected[1].articleId, c.id); assert(selected.every(item => item.reasons.length >= 3));
  assert.equal(selectBriefingItems([{ ...a, originalContent: false }], sourceMap).length, 0);
  assert.equal(selectBriefingItems([a], sourceMap).length, 1);
});
test('daily schedule follows Europe/Rome in both daylight-saving transitions and important updates respect cooldown', async () => {
  const settings = await getBriefingSettings(), items = selectBriefingItems([article('schedule')], sourceMap);
  assert.equal(briefingIsDue(settings, null, items, new Date('2026-03-29T04:59:00Z')).due, false);
  assert.equal(briefingIsDue(settings, null, items, new Date('2026-03-29T05:00:00Z')).due, true);
  assert.equal(briefingIsDue(settings, null, items, new Date('2026-10-25T05:59:00Z')).due, false);
  assert.equal(briefingIsDue(settings, null, items, new Date('2026-10-25T06:00:00Z')).due, true);
  const now = new Date('2026-10-22T12:00:00Z');
  const previous = { day: '2026-10-22', createdAt: now.toISOString(), fingerprint: 'previous', items: [] } as unknown as import('../src/lib/briefing-types').Briefing;
  assert.equal(briefingIsDue(settings, previous, items, now).due, false);
  assert.equal(briefingIsDue(settings, { ...previous, createdAt: '2026-10-22T07:00:00Z' }, items, now).due, false);
  const important = selectBriefingItems([article('important', 'economia', 90)], sourceMap);
  assert.equal(briefingIsDue(settings, { ...previous, createdAt: '2026-10-22T07:00:00Z' }, important, now).due, true);
});
test('unconfigured AI publishes only labelled composition of verified archive text and concurrent runs do not duplicate versions', async () => {
  await reset(); const a = article('archive-a'), b = article('archive-b', 'economia');
  await insert(a); await insert(b); await insert({ ...article('metadata'), originalContent: false, confirmed: [] });
  const results = await Promise.all([runBriefingCycle({ force: true, reason: 'Edizione di prova nel database isolato' }), runBriefingCycle({ force: true, reason: 'Secondo processo simultaneo isolato' })]);
  assert.equal(results.filter(result => result.state === 'published').length, 1);
  const current = await getPublicBriefing(); assert.equal(current?.items.length, 2); assert.equal(current?.mode, 'archive'); assert(current?.warnings.some(warning => warning.includes('Nessuna nuova sintesi AI')));
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM ai_usage'))[0].count), 0);
  assert.equal((await runBriefingCycle({ force: true, reason: 'Riprova idempotente nel database isolato' })).state, 'skipped');
  assert.equal((await getBriefingArchive()).length, 1);
});
test('article correction with unchanged timestamp invalidates public summary and appends an explicit immutable version', async () => {
  const before = await getPublicBriefing(); assert(before); const stored = (await query('SELECT payload FROM ai24_briefings WHERE id=?', [before.id]))[0].payload;
  const row = (await query('SELECT payload FROM events WHERE id=?', ['archive-a']))[0], changed = JSON.parse(String(row.payload));
  changed.summary = 'Testo corretto dal revisore senza cambiare updatedAt.'; await execute('UPDATE events SET payload=? WHERE id=?', [JSON.stringify(changed), changed.id]);
  const guarded = await getPublicBriefing(); assert.equal(guarded?.summary, ''); assert(!guarded?.items.some(item => item.articleId === changed.id));
  await reconcileBriefingsForArticle(changed.id, 'Correzione sostanziale della notizia collegata.');
  const current = await getPublicBriefing(); assert.equal(current?.version, 2); assert.equal(current?.items.length, 1); assert(current?.reason.includes('Correzione'));
  assert.equal((await query('SELECT payload FROM ai24_briefings WHERE id=?', [before.id]))[0].payload, stored);
  await reconcileBriefingsForArticle(changed.id, 'Riconciliazione ripetuta della medesima correzione.'); assert.equal((await getBriefingArchive()).length, 2);
});
test('withdrawn articles create a tombstone and older public versions cannot revive their briefing', async () => {
  await execute('UPDATE events SET status=? WHERE id=?', ['withdrawn', 'archive-b']);
  await reconcileBriefingsForArticle('archive-b', 'Ritiro editoriale della notizia rimasta nel riepilogo.');
  const current = await getPublicBriefing(); assert.equal(current?.state, 'withdrawn'); assert.equal(current?.items.length, 0); assert.equal(current?.summary, '');
  const old = await getPublicBriefing(romeDate(), 1); assert.equal(old?.state, 'withdrawn'); assert.equal(old?.items.length, 0);
});
test('budget boundary blocks provider request and labels fallback without claiming AI generation', async () => {
  await reset(); await insert(article('budget')); process.env.OPENAI_API_KEY = 'test-never-sent';
  await updateSettings({ monthlyBudgetUsd: 0 }); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Must never contact provider.'); };
  assert.equal((await runBriefingCycle({ force: true, reason: 'Prova isolata del limite mensile nullo' })).state, 'published');
  assert.equal(calls, 0); assert.equal((await getPublicBriefing())?.mode, 'archive');
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM ai_usage'))[0].count), 0);
  await updateSettings({ monthlyBudgetUsd: 200 });
});
test('AI output stays private for semantic review, charges once and preserves manual correction/withdrawal history', async () => {
  await reset(); const item = article('ai-review'); await insert(item); process.env.OPENAI_API_KEY = 'test-never-sent'; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 80 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ claims: [{ text: 'Riepilogo di prova verificabile basato sul documento pubblico selezionato.', articleIds: [item.id] }] }) }] }] }), { status: 200 }); };
  const result = await runBriefingCycle({ force: true, reason: 'Generazione di prova con risposta del provider simulata' }); assert.equal(result.state, 'review'); assert.equal(await getPublicBriefing(), null);
  await runBriefingCycle({ force: true, reason: 'Richiesta duplicata di prova senza un nuovo costo' }); assert.equal(calls, 1);
  const stored = JSON.parse(String((await query('SELECT payload FROM ai24_briefings WHERE id=?', [result.briefingId]))[0].payload));
  assert.equal(stored.controls.semanticReviewRequired, true); assert(stored.estimatedCostUsd > 0);
  await moderateBriefing(result.briefingId!, 'approve', 'Revisione umana isolata di ogni frase e delle attribuzioni.');
  assert.equal((await getPublicBriefing())?.mode, 'ai');
  const corrected = await moderateBriefing(result.briefingId!, 'correct', 'Correzione editoriale isolata di un passaggio del riepilogo.', 'Il riepilogo corretto di prova conserva soltanto le informazioni del documento pubblico.');
  assert.equal(corrected.version, 2);
  await assert.rejects(moderateBriefing(result.briefingId!, 'withdraw', 'Tentativo di usare una versione superata nella prova.'), /più recente/);
  await moderateBriefing(corrected.id, 'withdraw', 'Ritiro editoriale motivato dell’intero briefing nella prova.');
  assert.equal((await getPublicBriefing())?.state, 'withdrawn'); assert.equal((await getPublicBriefing(romeDate(), 1))?.summary, '');
});
test('pause during provider request prevents commit and retains measured cost without automatic retry', async () => {
  await reset(); const item = article('pause-ai'); await insert(item); process.env.OPENAI_API_KEY = 'test-never-sent'; let calls = 0;
  globalThis.fetch = async () => { calls++; await updateSettings({ safetyMode: true }); return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 110, output_tokens: 50 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ claims: [{ text: 'Testo isolato del riepilogo, mai pubblicato durante la sospensione.', articleIds: [item.id] }] }) }] }] }), { status: 200 }); };
  assert.equal((await runBriefingCycle({ force: true, reason: 'Prova di sospensione prima della pubblicazione del briefing' })).state, 'failed');
  assert.equal(await getPublicBriefing(), null); assert(Number((await query('SELECT actual_usd FROM ai_usage'))[0].actual_usd) > 0);
  await updateSettings({ safetyMode: false }); await runBriefingCycle({ force: true, reason: 'Riprova della selezione dopo sospensione senza nuova spesa' }); assert.equal(calls, 1);
});
test('unknown AI references fail validation, optional audio cannot activate and local modules reuse shared items', async () => {
  const item = article('local'); item.region = 'sicilia'; item.province = 'Palermo'; item.municipality = 'Castronovo di Sicilia'; item.locationEvidence = 'https://www.comune.castronovodisicilia.pa.it/notizia/';
  const items = selectBriefingItems([item, article('other')], sourceMap);
  assert.throws(() => validateBriefingClaims([{ text: 'Una frase non sostenuta.', articleIds: ['foreign'] }], items), /fuori/);
  await assert.rejects(updateBriefingSettings({ ...await getBriefingSettings(), audioEnabled: true }, 'Attivazione non autorizzata del servizio audio a pagamento.'), /non è configurata/);
  const additions = composeBriefingLocalItems(items, ['other'], { region: 'sicilia', province: 'Palermo', municipality: 'Castronovo di Sicilia', categories: [] });
  assert.deepEqual(additions.map(entry => entry.articleId), ['local']);
  assert.equal(composeBriefingLocalItems(items, [], { region: 'piemonte', province: '', municipality: '', categories: [] }).length, 0);
  assert.notEqual(articleBriefingVersion(item), articleBriefingVersion({ ...item, summary: 'Correzione senza timestamp nuovo.' }));
});
