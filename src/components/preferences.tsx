'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Check, MapPin, SlidersHorizontal } from 'lucide-react';
import { Article } from '@/lib/types';
import { categories, regions } from '@/lib/regions';
import { ArticleCard, EmptyState } from './news';

type Followed = Record<string, string>;
const followKey = 'italia-ora-followed';
const preferenceKey = 'italia-ora-preferences';
function readJson<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
export function FollowButton({ id, updatedAt }: { id: string; updatedAt: string }) {
  const [followed, setFollowed] = useState(false);
  useEffect(() => { setFollowed(Boolean(readJson<Followed>(followKey, {})[id])); }, [id]);
  function toggle() { const saved = readJson<Followed>(followKey, {}); if (saved[id]) delete saved[id]; else saved[id] = updatedAt; localStorage.setItem(followKey, JSON.stringify(saved)); setFollowed(Boolean(saved[id])); }
  return <button className={`button button-outline ${followed ? 'is-selected' : ''}`} onClick={toggle}>{followed ? <Check size={16} /> : <Bookmark size={16} />}{followed ? 'Stai seguendo questa notizia' : 'Segui gli aggiornamenti'}</button>;
}
export function ZonePicker() {
  const [region, setRegion] = useState('');
  useEffect(() => { setRegion(readJson<{ region?: string }>(preferenceKey, {}).region || ''); }, []);
  return <div className="zone-picker"><label htmlFor="home-region">Da dove vuoi iniziare?</label><select id="home-region" value={region} onChange={e => setRegion(e.target.value)}><option value="">Scegli la tua regione</option>{regions.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select><Link href={region ? `/regioni/${region}` : '/regioni'} className="button"><MapPin size={16} />Esplora la tua zona</Link><Link href="/la-mia-italia" className="subtle-link">Salva la zona e personalizza le notizie →</Link></div>;
}
export function PersonalizedNews({ articles }: { articles: Article[] }) {
  const [ready, setReady] = useState(false);
  const [region, setRegion] = useState(''); const [province, setProvince] = useState(''); const [municipality, setMunicipality] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [followed, setFollowed] = useState<Followed>({}); const [saved, setSaved] = useState(false);
  useEffect(() => { const value = readJson<{ region?: string; province?: string; municipality?: string; categories?: string[] }>(preferenceKey, {}); setRegion(value.region || ''); setProvince(value.province || ''); setMunicipality(value.municipality || ''); setSelected(Array.isArray(value.categories) ? value.categories : []); setFollowed(readJson<Followed>(followKey, {})); setReady(true); }, []);
  const provinces = [...new Set(articles.filter(a => a.region === region && a.province).map(a => a.province!))].sort();
  const municipalities = [...new Set(articles.filter(a => a.region === region && a.province === province && a.municipality).map(a => a.municipality!))].sort();
  const ranked = useMemo(() => { const score = (a: Article) => (!a.region && a.relevance >= 80 ? 1000 : 0) + (a.municipality && a.municipality === municipality ? 200 : 0) + (a.province && a.province === province ? 100 : 0) + (a.region && a.region === region ? 60 : 0) + (a.categories.some(c => selected.includes(c)) ? 30 : 0) + a.relevance; return [...articles].sort((a, b) => score(b) - score(a) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); }, [articles, region, province, municipality, selected]);
  function save() { localStorage.setItem(preferenceKey, JSON.stringify({ region, province, municipality, categories: selected })); setSaved(true); }
  function clear() { localStorage.removeItem(preferenceKey); setRegion(''); setProvince(''); setMunicipality(''); setSelected([]); setSaved(false); }
  const followedNews = articles.filter(a => followed[a.id]);
  return <><div className="preference-panel"><div className="panel-heading"><SlidersHorizontal size={19} /><h2>Un’Italia più vicina a te</h2></div><p>Le tue scelte restano su questo browser. Le notizie nazionali più rilevanti restano in evidenza.</p><div className="filter-row"><div className="field"><label htmlFor="region">Regione</label><select id="region" value={region} onChange={e => { setRegion(e.target.value); setProvince(''); setMunicipality(''); setSaved(false); }}><option value="">Tutta Italia</option>{regions.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select></div>{provinces.length > 0 && <div className="field"><label htmlFor="province">Provincia</label><select id="province" value={province} onChange={e => { setProvince(e.target.value); setMunicipality(''); setSaved(false); }}><option value="">Tutte le province disponibili</option>{provinces.map(p => <option key={p}>{p}</option>)}</select></div>}{municipalities.length > 0 && <div className="field"><label htmlFor="municipality">Comune</label><select id="municipality" value={municipality} onChange={e => { setMunicipality(e.target.value); setSaved(false); }}><option value="">Tutti i comuni disponibili</option>{municipalities.map(p => <option key={p}>{p}</option>)}</select></div>}</div><fieldset><legend>I tuoi interessi</legend><div className="category-pills">{categories.map(c => <button type="button" aria-pressed={selected.includes(c.slug)} className={`pill ${selected.includes(c.slug) ? 'selected' : ''}`} key={c.slug} onClick={() => { setSelected(prev => prev.includes(c.slug) ? prev.filter(v => v !== c.slug) : [...prev, c.slug]); setSaved(false); }}>{c.name}</button>)}</div></fieldset><p className="small-muted">Province e comuni compaiono soltanto quando ci sono notizie localizzate con riscontri.</p><div className="button-row"><button className="button" onClick={save}>{saved ? <Check size={16} /> : <Bookmark size={16} />}{saved ? 'Preferenze salvate' : 'Salva le preferenze'}</button><button className="button button-quiet" onClick={clear}>Azzera le scelte</button></div></div><section className="section"><div className="section-heading"><h2>Le notizie che segui</h2><span className="count-badge">{ready ? followedNews.length : '–'}</span></div>{followedNews.length ? <div className="news-grid">{followedNews.map(a => <div key={a.id}>{new Date(a.updatedAt) > new Date(followed[a.id]) && <span className="eyebrow">Nuovi aggiornamenti</span>}<ArticleCard article={a} /><FollowButton id={a.id} updatedAt={a.updatedAt} /></div>)}</div> : <EmptyState compact title="Le storie continuano. Seguile da qui." text="Usa “Segui gli aggiornamenti” su una notizia per ritrovarla in questa pagina. Le notifiche web non sono ancora attive." />}</section><section className="section"><div className="section-heading"><h2>Scelte per la tua Italia</h2></div>{ranked.length ? <div className="news-grid">{ranked.map(a => <ArticleCard key={a.id} article={a} />)}</div> : <EmptyState />}</section></>;
}
