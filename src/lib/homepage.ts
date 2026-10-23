import { execute, query, transaction } from './db';
import { getNews, getSources } from './store';
import { logAction } from './audit';
import type { Article } from './types';
import type { EditionEntry, HomepageEdition } from './newsroom-types';
export interface HomepageOverride { articleId:string;position:number|null;excluded:boolean;reason:string }
export async function getHomepageOverrides():Promise<HomepageOverride[]> {
  return (await query('SELECT event_id,position,excluded,reason FROM homepage_overrides')).map(row => ({articleId:String(row.event_id),position:row.position === null?null:Number(row.position),excluded:Boolean(Number(row.excluded)),reason:String(row.reason)}));
}
export function rankHomepage(articles:Article[], overrides:HomepageOverride[], officialSources:Set<string>, now=Date.now()):EditionEntry[] {
  const rules = new Map(overrides.map(value=>[value.articleId,value]));
  const candidates = articles.filter(article => article.status === 'published' && !rules.get(article.id)?.excluded).filter(article => {
    if (rules.get(article.id)?.position) return true;
    const original = article.citations.map(c=>c.publishedAt && new Date(c.publishedAt).getTime()).filter((date):date is number=>typeof date === 'number' && Number.isFinite(date));
    return original.length > 0 && Math.max(...original) >= now - 72*3600_000 && Math.max(...original) <= now + 5*60_000;
  }).map(article => {
    const sourceDate = Math.max(...article.citations.map(c=>c.publishedAt?new Date(c.publishedAt).getTime():0));
    const ageHours = Math.max(0,(now-sourceDate)/3600_000);
    const relevance = Math.max(0,Math.min(100,article.relevance));
    const freshness = Math.max(0,20-Math.floor(ageHours/3));
    const official = article.citations.some(c=>officialSources.has(c.sourceId))?8:0;
    const original = article.originalContent?8:0;
    const national = article.region?0:5;
    return {article,score:relevance+freshness+official+original+national,reasons:[`Rilevanza editoriale: ${relevance}/100`,`Attualità basata sulla data della fonte: +${freshness}`, ...(official?['Riferimento a fonte istituzionale: +8']:[]), ...(original?['Contenuto originale disponibile: +8']:[]), ...(national?['Interesse nazionale: +5']:[])]};
  });
  const result:EditionEntry[] = [];
  const used = new Set<string>(); const categoryCounts = new Map<string,number>();
  for (let position=1;position<=Math.min(12,candidates.length);position++) {
    const pinned = candidates.find(entry=>rules.get(entry.article.id)?.position===position&&!used.has(entry.article.id));
    const available = candidates.filter(entry=>!used.has(entry.article.id) && (!rules.get(entry.article.id)?.position || rules.get(entry.article.id)!.position! <= position));
    const sorted = available.map(entry=>({...entry,penalty:(categoryCounts.get(entry.article.categories[0]||'')||0)*16})).sort((a,b)=>(b.score-b.penalty)-(a.score-a.penalty) || new Date(b.article.publishedAt).getTime()-new Date(a.article.publishedAt).getTime() || a.article.id.localeCompare(b.article.id));
    const selected = pinned || sorted[0] || candidates.find(entry=>!used.has(entry.article.id));
    if (!selected) break;
    const repeated = categoryCounts.get(selected.article.categories[0]||'')||0;
    result.push({articleId:selected.article.id,score:selected.score-(pinned?0:repeated*16),reasons:[...selected.reasons,...(pinned?[`Posizione fissata dalla redazione: ${rules.get(selected.article.id)!.reason}`]:repeated?[`Diversità degli argomenti: penalità ${repeated*16}`]:['Argomento non ancora presente nella selezione'])],pinned:Boolean(pinned),position});
    used.add(selected.article.id);categoryCounts.set(selected.article.categories[0]||'',repeated+1);
  }
  return result;
}
export async function getHomepageEdition():Promise<HomepageEdition|null> {const row=(await query('SELECT payload FROM homepage_editions WHERE id=?',['current']))[0];return row?JSON.parse(String(row.payload)):null;}
export async function rebuildHomepageEdition():Promise<HomepageEdition> {
  const [articles,sources,overrides] = await Promise.all([getNews({limit:1000}),getSources(),getHomepageOverrides()]);
  const entries = rankHomepage(articles,overrides,new Set(sources.filter(source=>source.authorized&&source.official).map(source=>source.id)));
  const current=await getHomepageEdition();
  if (current && JSON.stringify(current.entries)===JSON.stringify(entries)) return current;
  const edition:HomepageEdition={generatedAt:new Date().toISOString(),entries};
  await execute('INSERT INTO homepage_editions (id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at',['current',JSON.stringify(edition),edition.generatedAt]);
  await logAction('chief','homepage-ranked',null,{entries});
  return edition;
}
export async function getHomepageSelection():Promise<Article[]> {
  const [articles,edition,overrides,sources]=await Promise.all([getNews({limit:1000}),getHomepageEdition(),getHomepageOverrides(),getSources()]);
  const entries=edition?.entries||rankHomepage(articles,overrides,new Set(sources.filter(s=>s.authorized&&s.official).map(s=>s.id)));
  const excluded=new Set(overrides.filter(rule=>rule.excluded).map(rule=>rule.articleId));
  const byId=new Map(articles.filter(article=>!excluded.has(article.id)).map(article=>[article.id,article]));
  return entries.map(entry=>byId.get(entry.articleId)).filter((article):article is Article=>Boolean(article));
}
export async function setHomepageOverride(rule:HomepageOverride) {
  await transaction(async()=>{
    const rows=await query('SELECT id FROM events WHERE id=? AND status=?',[rule.articleId,'published']);
    if (!rows.length) throw new Error('Puoi ordinare soltanto contenuti pubblicati.');
    if(rule.position!==null&&(!Number.isInteger(rule.position)||rule.position<1||rule.position>12))throw new Error('La posizione deve essere tra 1 e 12.');
    if(rule.excluded&&rule.position!==null)throw new Error('Un contenuto escluso non può avere una posizione fissata.');
    if(rule.reason.trim().length<10)throw new Error('Serve una motivazione editoriale di almeno 10 caratteri.');
    if(rule.position!==null)await execute('UPDATE homepage_overrides SET position=NULL WHERE position=? AND event_id<>?',[rule.position,rule.articleId]);
    await execute('INSERT INTO homepage_overrides (event_id,position,excluded,reason,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET position=excluded.position,excluded=excluded.excluded,reason=excluded.reason,updated_at=excluded.updated_at',[rule.articleId,rule.position,rule.excluded?1:0,rule.reason.trim(),new Date().toISOString()]);
    await logAction('chief','homepage-override',rule.articleId,{...rule});
  });
  await rebuildHomepageEdition();
}
