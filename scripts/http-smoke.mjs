import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Read-only smoke test: public GET requests and an unauthorized cron POST.
// It never calls ingestion, login, reports, settings or editorial mutation APIs.
const base = new URL(process.env.TEST_BASE_URL || 'http://localhost:3000');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
  throw new Error('TEST_BASE_URL deve essere un URL HTTP(S) senza credenziali.');
}
const expectNoindex = process.env.TEST_EXPECT_NOINDEX !== 'false';
const allowEmptyNews = process.env.TEST_ALLOW_EMPTY_NEWS === 'true';
const regions = [
  'abruzzo', 'basilicata', 'calabria', 'campania', 'emilia-romagna',
  'friuli-venezia-giulia', 'lazio', 'liguria', 'lombardia', 'marche',
  'molise', 'piemonte', 'puglia', 'sardegna', 'sicilia', 'toscana',
  'trentino-alto-adige', 'umbria', 'valle-d-aosta', 'veneto',
];
const categories = [
  'cronaca', 'politica', 'economia', 'lavoro', 'salute', 'scuola',
  'tecnologia', 'sport', 'spettacolo', 'ambiente', 'meteo', 'trasporti',
  'giustizia', 'eventi',
];
const pages = [
  '/', '/ultim-ora', '/italia', '/fonti', '/regioni', '/cerca',
  '/cerca?q=clima', '/la-mia-italia', '/correzioni', '/riepilogo',
  '/metodo', '/chiedi', '/segnala', '/admin', '/legale/contatti', '/legale/privacy',
  '/legale/cookie', '/legale/termini',
  '/carburanti', '/guerra-silenziosa', '/italia-in-numeri', '/quanto-mi-costa-vivere',
  '/il-mio-comune', '/cosa-cambia-davvero', '/briefing', '/briefing/archivio',
  '/sport', '/sport/risultati', '/sport/calendario', '/sport/classifiche', '/sport/le-mie-squadre', '/offline',
  ...categories.map((slug) => `/categoria/${slug}`),
  ...regions.map((slug) => `/regioni/${slug}`),
];

let fileEnv = {};
try {
  fileEnv = parseEnv(await readFile(new URL('../.env.local', import.meta.url), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const secretKeys = ['OPENAI_API_KEY', 'DATABASE_URL', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET'];
const secrets = secretKeys.flatMap((key) => [process.env[key], fileEnv[key]]
  .filter((value) => typeof value === 'string' && value.length >= 12)
  .map((value) => ({ key, value })));
const failures = [];
let passed = 0;
let skipped = 0;
let requestCount = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function noSecrets(text) {
  for (const { key, value } of secrets) {
    const encoded = JSON.stringify(value).slice(1, -1);
    assert(!text.includes(value) && !text.includes(encoded), `Segreto ${key} presente nella risposta pubblica`);
  }
  assert(!/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/.test(text), 'Possibile chiave API presente nella risposta pubblica');
  assert(!/postgres(?:ql)?:\/\/[^\s<>"']{2,}@/i.test(text), 'Possibile credenziale PostgreSQL nella risposta pubblica');
}
async function request(path, { method = 'GET', status = 200 } = {}) {
  const url = new URL(path, base);
  assert(url.origin === base.origin, 'URL di test fuori dal sito selezionato');
  requestCount += 1;
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(45_000),
    headers: { Accept: path.startsWith('/api/') ? 'application/json' : 'text/html, application/xml, text/plain' },
  });
  const text = await response.text();
  assert(response.status === status, `HTTP ${response.status}, atteso ${status}`);
  noSecrets(text);
  assert(!/Application error: (?:a server|a client)|Internal Server Error|NEXT_HTTP_ERROR_FALLBACK;(?:404|500)|"digest":"(?:[0-9]{6,}|NEXT_)/i.test(text), 'Pagina con errore applicativo');
  return { response, text };
}
async function check(name, work) {
  try {
    await work();
    passed += 1;
  } catch (error) {
    failures.push({ name, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function pool(items, work, concurrency = 4) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await work(items[index]);
    }
  }));
}
function noindexMeta(text) {
  return /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(text)
    || /<meta\s+[^>]*content=["'][^"']*noindex[^>]*name=["']robots["']/i.test(text);
}

console.log(`HTTP smoke: ${base.origin}; ${pages.length} pagine, API pubbliche, protezioni amministrative e SEO.`);
await pool(pages, (path) => check(`pagina ${path}`, async () => {
  const { response, text } = await request(path);
  assert(response.headers.get('content-type')?.includes('text/html'), 'Risposta non HTML');
  assert(/<html[\s>]/i.test(text) && /<body[\s>]/i.test(text), 'Documento HTML incompleto');
  if (path === '/' && expectNoindex) assert(noindexMeta(text), 'Homepage priva di meta robots noindex');
  if (path === '/') assert(text.includes('giornale-ai24-logo.png') && text.includes('GIORNALE AI24 — by KEG Studios'), 'Logo fornito assente dall’intestazione');
}));

let articles = [];
await check('GET /api/news: articoli pubblici reali', async () => {
  const { text } = await request('/api/news');
  const data = JSON.parse(text);
  assert(Array.isArray(data), 'API news deve restituire un array');
  assert(data.every((article) => article.status === 'published' && typeof article.slug === 'string'), 'API news include contenuti non pubblicati o privi di slug');
  if (!data.length && allowEmptyNews) {
    skipped += 1;
    console.log('SKIP verifica articoli: database intenzionalmente vuoto (TEST_ALLOW_EMPTY_NEWS=true).');
  } else {
    assert(data.length > 0, 'Nessun articolo reale disponibile: eseguire la raccolta separatamente prima del test');
  }
  for (const article of data) {
    assert(Array.isArray(article.citations) && article.citations.length > 0, 'Articolo pubblicato senza fonti');
    for (const citation of article.citations) {
      const original = new URL(citation.url);
      assert(original.protocol === 'https:' && original.hostname.includes('.'), 'Fonte originale priva di URL HTTPS valido');
    }
  }
  articles = data;
});

await check('GET /api/news con filtri', async () => {
  const { text } = await request('/api/news?category=ambiente&q=clima&region=sicilia');
  assert(Array.isArray(JSON.parse(text)), 'API news filtrata non restituisce un array');
});
await check('GET /api/status', async () => {
  const { response, text } = await request('/api/status');
  const data = JSON.parse(text);
  assert(Number.isInteger(data.activeSources) && data.activeSources >= 0, 'Conteggio fonti non valido');
  assert(Number.isInteger(data.totalPublished) && data.totalPublished >= 0, 'Conteggio notizie non valido');
  assert(typeof data.paused === 'boolean' && data.intervalMinutes >= 5, 'Stato schedulazione non valido');
  assert(response.headers.get('cache-control')?.includes('no-store'), 'Stato del sistema memorizzato in cache');
});
await check('GET /api/admin senza sessione = 401', () => request('/api/admin', { status: 401 }));
await check('GET /api/newsroom senza sessione = 401', () => request('/api/newsroom', { status: 401 }));
for (const path of ['/api/admin/briefing','/api/admin/civic','/api/admin/sports','/api/admin/health']) await check(`GET ${path} senza sessione = 401`,()=>request(path,{status:401}));
await check('POST /api/cron senza segreto = 401', () => request('/api/cron', { method: 'POST', status: 401 }));
await check('POST /api/chat senza Origin = 403', () => request('/api/chat', { method: 'POST', status: 403 }));
await check('Logo PNG pubblico disponibile', async () => {
  const response = await fetch(new URL('/brand/giornale-ai24-logo.png', base), { signal: AbortSignal.timeout(15_000) });
  requestCount += 1;
  assert(response.ok && response.headers.get('content-type')?.includes('image/png'), 'Logo PNG non disponibile');
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(bytes.length > 1000 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71, 'File logo PNG non valido');
});
await check('Prezzi MIMIT filtrati con unità e provenienza',async()=>{
  const {text}=await request('/api/carburanti?municipality=Milano&fuel=Benzina&service=self');const data=JSON.parse(text);
  assert(Array.isArray(data.items),'Risultati carburanti assenti');
  assert(data.items.every(item=>item.price>0&&item.unit==='€/l'&&item.service==='self'&&item.station.municipality.toUpperCase()==='MILANO'&&item.reportedAt&&item.datasetDate),'Risultato carburante incoerente');
  if(data.items.length)assert(data.items.every((item,index)=>index===0||item.price>=data.items[index-1].price),'Prezzi non ordinati');
});
await check('Filtri carburanti non validi = 400',()=>request('/api/carburanti?latitude=999&longitude=12',{status:400}));
await check('API briefing pubblica, senza generazione durante GET',async()=>{const {response,text}=await request('/api/briefing');assert(response.headers.get('cache-control')?.includes('no-store'),'Briefing in cache HTTP');assert(!text.includes('OPENAI_API_KEY'),'Configurazione provider esposta');});
await check('API sport pubblica',()=>request('/api/sports'));
await check('Ricerca interna senza chiamate al modello',async()=>{const {text}=await request('/api/search?q=carburanti');const data=JSON.parse(text);assert(data.items.some(item=>item.url==='/carburanti'),'Ricerca strumenti non collegata');});
await check('Manifest installabile e service worker',async()=>{const {text}=await request('/manifest.webmanifest');const manifest=JSON.parse(text);assert(manifest.name.includes('GIORNALE AI24')&&manifest.icons.length>0,'Manifest incompleto');const sw=await request('/sw.js');assert(sw.response.headers.get('cache-control')?.includes('no-store'),'Service worker senza aggiornamento garantito');});

await pool(articles, (article) => check(`articolo /notizie/${article.slug}`, async () => {
  const { text } = await request(`/notizie/${encodeURIComponent(article.slug)}`);
  assert(/<html[\s>]/i.test(text), 'Pagina articolo non HTML');
  if (!article.originalContent) assert(noindexMeta(text), 'Articolo di soli metadati privo di noindex');
  for (const citation of article.citations) {
    const link = citation.url.replaceAll('&', '&amp;');
    assert(text.includes(citation.url) || text.includes(link), 'Pagina articolo priva di un collegamento alla fonte');
  }
}));

await check('GET /robots.txt: indicizzazione disattivata per default', async () => {
  const { text } = await request('/robots.txt');
  if (expectNoindex) assert(/^Disallow:\s*\/\s*$/im.test(text), 'robots.txt non blocca il sito in modalità noindex');
});
await check('GET /sitemap.xml: nessun articolo di soli metadati', async () => {
  const { text } = await request('/sitemap.xml');
  assert(/<(?:urlset|sitemapindex)\b/i.test(text), 'Sitemap XML non riconosciuta');
  for (const article of articles.filter((item) => !item.originalContent)) {
    const rawPath = `/notizie/${article.slug}`;
    assert(!text.includes(rawPath) && !text.includes(`/notizie/${encodeURIComponent(article.slug)}`), 'Sitemap include un articolo di soli metadati');
  }
});

console.log(JSON.stringify({
  baseUrl: base.origin,
  requests: requestCount,
  passed,
  failed: failures.length,
  skipped,
  articlePages: articles.length,
  regionPages: regions.length,
  categoryPages: categories.length,
  completedAt: new Date().toISOString(),
}));
if (failures.length) process.exitCode = 1;
