import { XMLParser, XMLValidator } from 'fast-xml-parser';

const sources = [
  {
    id: 'ispra-news',
    url: 'https://www.isprambiente.gov.it/it/news/notizie/RSS',
    origin: 'https://www.isprambiente.gov.it',
    license: 'https://www.isprambiente.gov.it/it/note-legali',
  },
  {
    id: 'dpc-news',
    url: 'https://api.protezionecivile.it/default/dpcPortalGenerateRss?categoria=notizia',
    origin: 'https://www.protezionecivile.gov.it',
    license: 'https://www.protezionecivile.gov.it/it/approfondimento/note-legali-0/',
  },
  {
    id: 'dpc-press',
    url: 'https://api.protezionecivile.it/default/dpcPortalGenerateRss?categoria=comunicato_stampa',
    origin: 'https://www.protezionecivile.gov.it',
    license: 'https://www.protezionecivile.gov.it/it/approfondimento/note-legali-0/',
  },
];
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const array = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

async function check(source) {
  const response = await fetch(source.url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('Risposta priva di corpo');
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error('Feed superiore al limite di 2 MB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('DTD/entità XML non consentite');
  const validation = XMLValidator.validate(content);
  if (validation !== true) throw new Error(`XML non valido: ${validation.err.msg}`);
  const parsed = parser.parse(content);
  const channel = parsed.rss?.channel ?? parsed['rdf:RDF']?.channel;
  const items = array(parsed.rss?.channel?.item ?? parsed['rdf:RDF']?.item);
  if (!channel || !items.length) throw new Error('Feed RSS senza elementi');
  const validItems = items.filter((item) => {
    try {
      const link = new URL(item.link);
      return link.origin === source.origin && link.pathname.startsWith('/it/');
    } catch {
      return false;
    }
  });
  if (!validItems.length) throw new Error('Nessun elemento italiano con URL autorizzato');
  const dates = validItems.map((item) => item.pubDate ?? item['dc:date']);
  if (dates.some((date) => !date || !Number.isFinite(Date.parse(date)))) {
    throw new Error('Uno o più elementi non hanno una data valida');
  }
  return {
    source: source.id,
    checkedAt: new Date().toISOString(),
    url: source.url,
    status: response.status,
    bytes,
    format: parsed.rss ? 'RSS 2.0' : 'RSS 1.0 / RDF',
    declaredContentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    items: items.length,
    italianItems: validItems.length,
    newestPublishedAt: new Date(Math.max(...dates.map(Date.parse))).toISOString(),
    firstOriginalUrl: validItems[0].link,
    rightsNoticeItems: validItems.filter((item) => Boolean(item['dc:rights']?.trim())).length,
    termsUrl: source.license,
  };
}

const results = await Promise.allSettled(sources.map(check));
for (let index = 0; index < results.length; index += 1) {
  const result = results[index];
  if (result.status === 'fulfilled') {
    console.log(JSON.stringify(result.value));
  } else {
    process.exitCode = 1;
    console.error(JSON.stringify({ source: sources[index].id, error: result.reason.message }));
  }
}
