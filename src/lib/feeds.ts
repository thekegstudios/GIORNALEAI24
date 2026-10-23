import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import type { Source } from './types';
import { safePublicUrl } from './editorial';

export interface FeedItem { sourceId:string; externalId:string; url:string; title:string; publishedAt:string|null; text:string; hash:string; rightsNotice?:string }
const array=(value:unknown):unknown[]=>value==null?[]:Array.isArray(value)?value:[value];
export function plainText(value:unknown):string {
  const text=typeof value==='object'&&value ? String((value as Record<string,unknown>)['#text']||'') : String(value??'');
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}
export function canonicalUrl(value:string):string|null {
  if(!safePublicUrl(value))return null;
  const url=new URL(value);url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
  return url.toString();
}
export function parseFeed(xml:string,source:Source):FeedItem[] {
  if(xml.length>2_000_000)throw new Error('Feed oltre il limite di 2 MB');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Dichiarazioni XML non consentite');
  if(XMLValidator.validate(xml)!==true)throw new Error('RSS/XML non valido');
  const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:false,trimValues:true}).parse(xml);
  const entries=array(parsed.rss?.channel?.item ?? parsed['rdf:RDF']?.item ?? parsed.feed?.entry);
  const results:FeedItem[]=[];
  for(const entry of entries.slice(0,100)) {
    const item=entry as Record<string,unknown>;
    let link='';
    for(const candidate of array(item.link)) {
      if(typeof candidate==='string') {link=candidate;break;}
      if(candidate&&typeof candidate==='object') {
        const object=candidate as Record<string,unknown>;
        if(!object['@_rel'] || object['@_rel']==='alternate'){link=String(object['@_href']||object['#text']||'');break;}
      }
    }
    const url=canonicalUrl(link.trim());
    const title=plainText(item.title).slice(0,400);
    if(!url || !title || (source.id==='protezione-civile'&&!new URL(url).pathname.startsWith('/it/')))continue;
    const destination=new URL(url);
    if(source.homepage&&destination.hostname!==new URL(source.homepage).hostname)continue;
    if(['ispra','protezione-civile'].includes(source.id)&&!destination.pathname.startsWith('/it/'))continue;
    const rightsNotice=plainText(item['dc:rights']??item.rights);
    // A per-item notice overrides the general site license. Unrecognized notices
    // require rights review outside the automatic importer.
    if(rightsNotice&&!/^(?:https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/?|CC[ -]BY[ -]4\.0)$/i.test(rightsNotice))continue;
    // RSS text is only retained where the source register explicitly permits summaries.
    const text=source.allowSummary?plainText(item.description ?? item.summary ?? item.content ?? item['content:encoded']).slice(0,12000):'';
    const dateRaw=plainText(item.pubDate??item['dc:date']??item.published??item.updated);
    const date=new Date(dateRaw);
    const publishedAt=Number.isFinite(date.getTime())?date.toISOString():null;
    const externalId=plainText(item.guid??item.id??url);
    const hash=createHash('sha256').update(JSON.stringify({url,title,text,publishedAt})).digest('hex');
    results.push({sourceId:source.id,externalId,url,title,text,publishedAt,hash,rightsNotice});
  }
  return results;
}
export async function fetchFeed(source:Source):Promise<FeedItem[]> {
  if(!source.authorized || !source.enabled || !source.feedUrl || !safePublicUrl(source.feedUrl))throw new Error('Connettore non autorizzato o disabilitato');
  let error:unknown;
  for(let attempt=0;attempt<2;attempt++) {
    try{
      let current=source.feedUrl;
      let response:Response|undefined;
      for(let redirects=0;redirects<4;redirects++) {
        response=await fetch(current,{signal:AbortSignal.timeout(12000),redirect:'manual',headers:{'User-Agent':'GiornaleAI24/0.1 (RSS reader; authorized metadata only)','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml'}});
        if(response.status>=300&&response.status<400){
          const location=response.headers.get('location');
          if(!location)throw new Error('Redirect privo di destinazione');
          const next=new URL(location,current);
          if(!safePublicUrl(next.toString())||next.hostname!==new URL(source.feedUrl).hostname)throw new Error('Redirect fuori dal dominio autorizzato');
          current=next.toString();continue;
        }
        break;
      }
      if(!response?.ok){
        const status=response?.status||0;
        if([401,403,404,429].includes(status))throw new FeedAccessError(`Feed HTTP ${status}; accesso non aggirato`);
        throw new Error(`Feed HTTP ${status}`);
      }
      const length=Number(response.headers.get('content-length')||0);
      if(length>2_000_000)throw new Error('Feed oltre il limite di 2 MB');
      const reader=response.body?.getReader();if(!reader)throw new Error('Feed vuoto');
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2_000_000){await reader.cancel();throw new Error('Feed oltre il limite di 2 MB');}chunks.push(part.value);}
      return parseFeed(Buffer.concat(chunks).toString('utf8'),source);
    }catch(caught){error=caught;if(caught instanceof FeedAccessError)break;}
  }
  throw error;
}
class FeedAccessError extends Error {}
