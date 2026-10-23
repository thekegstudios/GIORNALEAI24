/* GIORNALE AI24: explicit public-article snapshots, never a general HTML/API cache. */
'use strict';
const STATIC_CACHE='ai24-static-v1';
const ARTICLE_CACHE='ai24-articles-v1';
const MAX_ARTICLES=20;
const MAX_AGE=7*24*60*60*1000;
const ICONS=['/brand/ai24-icon.svg','/brand/ai24-icon-192.png','/brand/ai24-icon-512.png','/brand/giornale-ai24-logo.png'];
const articlePath=pathname=>/^\/notizie\/[a-zA-Z0-9-]{1,250}$/.test(pathname);
const privatePath=pathname=>/^\/(?:api|admin|carburanti|sport)(?:\/|$)/.test(pathname);
const allowedAsset=url=>url.origin===self.location.origin&&!url.search&&(ICONS.includes(url.pathname)||/^\/_next\/static\/(?:chunks|css|media)\/(?:[^/]+\/)*[^/]*[a-f0-9]{8,}[^/]*\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/.test(url.pathname));
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const title=response=>{try{return decodeURIComponent(response.headers.get('X-AI24-Article-Title')||'Notizia salvata');}catch{return 'Notizia salvata';}};
const saved=response=>response.headers.get('X-AI24-Offline-Saved-At')||'';
async function savedArticles(){
  const cache=await caches.open(ARTICLE_CACHE),result=[];
  for(const request of await cache.keys()){
    const response=await cache.match(request);if(!response)continue;
    const at=saved(response);
    if(!Number.isFinite(Date.parse(at))||Date.now()-Date.parse(at)>MAX_AGE||!articlePath(new URL(request.url).pathname)){await cache.delete(request);continue;}
    result.push({slug:new URL(request.url).pathname.split('/').at(-1),title:title(response),savedAt:at,updatedAt:response.headers.get('X-AI24-Article-Updated-At')||'',url:new URL(request.url).pathname});
  }
  return result.reverse().sort((a,b)=>Date.parse(b.savedAt)-Date.parse(a.savedAt));
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(STATIC_CACHE);
  await Promise.allSettled(ICONS.map(async path=>{const response=await fetch(path,{credentials:'omit',cache:'reload'});if(response.ok)await cache.put(path,response);}));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('ai24-')&&![STATIC_CACHE,ARTICLE_CACHE].includes(key))await caches.delete(key);
  await savedArticles();await self.clients.claim();
})()));
async function offlineIndex(){
  const articles=await savedArticles();
  const list=articles.length?`<ul>${articles.map(item=>`<li><a href="${escape(item.url)}">${escape(item.title)}</a><small>Copia del ${escape(new Date(item.savedAt).toLocaleString('it-IT',{timeZone:'Europe/Rome'}))}</small></li>`).join('')}</ul>`:'<p>Non ci sono copie salvate su questo dispositivo. Quando torni online, usa “Salva per leggere offline” sotto una notizia.</p>';
  return new Response(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#061727"><title>Sei offline · GIORNALE AI24</title><style>body{margin:0;background:#071a29;color:#e8f1f8;font:16px/1.8 system-ui,sans-serif}main{max-width:720px;margin:auto;padding:36px 22px}h1{font:38px Georgia,serif}a{color:#88d9ff}li{margin:20px 0}small{display:block;color:#a1becf}.status{padding:16px;border:1px solid #459cbd;border-radius:8px}nav{display:flex;gap:24px;margin-top:30px}</style></head><body><main><p>GIORNALE AI24 · by KEG Studios</p><h1>Sei offline</h1><p class="status">La connessione al sito non è disponibile. Le copie sotto riportano la data del salvataggio: non sono dati attuali. Prezzi, risultati sportivi, chat e pannello amministrativo richiedono una connessione.</p><h2>Articoli salvati</h2>${list}<p>Massimo ${MAX_ARTICLES} copie, per ${MAX_AGE/86400000} giorni. Torna online per aggiornare o eliminare le copie dalla pagina di gestione.</p><nav><a href="/">Riprova la homepage</a><a href="/offline">Riprova la gestione offline</a></nav></main></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-AI24-Offline':'unavailable','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
async function validateSavedArticle(path){
  const cache=await caches.open(ARTICLE_CACHE),prior=await cache.match(path);if(!prior)return;
  try{
    const response=await fetch(`/offline-articoli/${path.split('/').at(-1)}`,{method:'HEAD',cache:'no-store',credentials:'omit',redirect:'error'});
    if(response.status===403||response.status===404||response.ok&&response.headers.get('X-AI24-Article-Updated-At')!==prior.headers.get('X-AI24-Article-Updated-At'))await cache.delete(path);
  }catch{/* Offline copies remain clearly dated until a successful online validation. */}
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||privatePath(url.pathname))return;
  if(request.mode==='navigate'){
    if(url.search||url.pathname.startsWith('/offline-articoli/'))return;
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(articlePath(url.pathname)){
          if(response.status===404||response.status===410)await(await caches.open(ARTICLE_CACHE)).delete(url.pathname);
          else if(response.ok)await validateSavedArticle(url.pathname);
        }
        return response;
      }catch{
        if(articlePath(url.pathname)){
          await savedArticles();const cached=await(await caches.open(ARTICLE_CACHE)).match(url.pathname);
          if(cached)return cached;
        }
        return offlineIndex();
      }
    })());return;
  }
  if(allowedAsset(url))event.respondWith((async()=>{
    const cache=await caches.open(STATIC_CACHE);
    try{const response=await fetch(request);if(response.ok&&response.type!=='opaque'){await cache.put(request,response.clone());const keys=await cache.keys();const expendable=keys.filter(key=>!ICONS.includes(new URL(key.url).pathname));for(const old of expendable.slice(0,Math.max(0,keys.length-120)))await cache.delete(old);}return response;}
    catch{const cached=await cache.match(request);return cached||new Response(null,{status:503});}
  })());
});
self.addEventListener('message',event=>{
  const port=event.ports&&event.ports[0],data=event.data;
  if(!port||!data||typeof data.type!=='string'||!event.source||typeof event.source.url!=='string')return;
  let source;try{source=new URL(event.source.url);}catch{return;}
  if(source.origin!==self.location.origin||privatePath(source.pathname))return;
  event.waitUntil((async()=>{
    try{
      if(data.type==='LIST_ARTICLES'){port.postMessage({ok:true,articles:await savedArticles()});return;}
      if(data.type==='CLEAR_ARTICLES'){await caches.delete(ARTICLE_CACHE);port.postMessage({ok:true,articles:[]});return;}
      if(!['SAVE_ARTICLE','REMOVE_ARTICLE'].includes(data.type)||typeof data.slug!=='string'||!/^[a-zA-Z0-9-]{1,250}$/.test(data.slug))throw new Error('Richiesta non valida.');
      const cache=await caches.open(ARTICLE_CACHE),path=`/notizie/${data.slug}`;
      if(data.type==='REMOVE_ARTICLE'){await cache.delete(path);port.postMessage({ok:true,articles:await savedArticles()});return;}
      const response=await fetch(`/offline-articoli/${data.slug}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok||response.headers.get('X-AI24-Offline')!=='article'||response.headers.get('X-AI24-Article-Slug')!==data.slug||!response.headers.get('Content-Type')?.includes('text/html'))throw new Error('Notizia non disponibile o non autorizzata al salvataggio.');
      const text=await response.text();if(new TextEncoder().encode(text).byteLength>300000)throw new Error('Questa copia è troppo grande per il salvataggio.');
      await cache.put(path,new Response(text,{headers:response.headers}));
      const articles=await savedArticles();for(const old of articles.slice(MAX_ARTICLES))await cache.delete(old.url);
      port.postMessage({ok:true,articles:await savedArticles()});
    }catch(error){port.postMessage({ok:false,error:error instanceof Error?error.message:'Operazione offline non disponibile.'});}
  })());
});
