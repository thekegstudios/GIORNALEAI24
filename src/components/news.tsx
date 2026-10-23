import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Newspaper, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import { Article } from '@/lib/types';
import { categoryName, regionName } from '@/lib/regions';
import { formatDate, formatTime, fullDate } from '@/lib/format';

export function SectionHeading({ title, label, href, description }: { title: string; label?: string; href?: string; description?: string }) {
  return <div className="section-heading"><div>{label && <span className="eyebrow">{label}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{href && <Link className="text-link" href={href}>Tutte le notizie <ArrowRight size={15} /></Link>}</div>;
}
export function EmptyState({ title = 'Nessuna nuova notizia verificata.', text = 'Qui troverai le notizie dopo la raccolta dalle fonti autorizzate e i controlli editoriali.', compact = false }: { title?: string; text?: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><span className="empty-icon"><Newspaper size={compact ? 22 : 28} strokeWidth={1.3} /></span><h3>{title}</h3><p>{text}</p>{!compact && <Link href="/metodo" className="text-link">Come selezioniamo le notizie <ArrowRight size={15} /></Link>}</div>;
}
export function ArticleCard({ article, featured = false, number }: { article: Article; featured?: boolean; number?: number }) {
  const Heading = featured ? 'h2' : 'h3';
  const datedSource = article.citations.find(c => c.publishedAt);
  return <article className={`article-card ${featured ? 'featured' : ''}`}>{number !== undefined && <span className="article-number">{String(number).padStart(2, '0')}</span>}<div className="card-content"><div className="article-kicker"><span>{categoryName(article.categories[0] || 'cronaca')}</span>{article.region && <><span className="dot-separator">·</span><span>{regionName(article.region)}</span></>}</div><Heading><Link href={`/notizie/${article.slug}`}>{article.title}</Link></Heading><p>{article.summary}</p><div className="article-meta"><time dateTime={article.updatedAt} title={fullDate(article.updatedAt)}>Portale: {formatDate(article.updatedAt, { month: 'short' })}, {formatTime(article.updatedAt)}</time><span>·</span><span>{article.citations.length} {article.citations.length === 1 ? 'fonte' : 'fonti'}</span>{!article.originalContent && <span className="metadata-label">Dalla fonte</span>}{datedSource?.publishedAt && <time className="source-date" dateTime={datedSource.publishedAt}>Fonte: {datedSource.sourceName} · {fullDate(datedSource.publishedAt)}</time>}</div></div>{featured && <Link className="round-arrow" href={`/notizie/${article.slug}`} aria-label={`Leggi: ${article.title}`}><ArrowUpRight size={23} /></Link>}</article>;
}
export function NewsGrid({ articles }: { articles: Article[] }) {
  return articles.length ? <div className="news-grid">{articles.map(a => <ArticleCard key={a.id} article={a} />)}</div> : <EmptyState />;
}
export function TrustStrip() {
  return <div className="trust-strip"><span><ShieldCheck size={17} /> Fonti sempre consultabili</span><span><Sparkles size={17} /> AI dichiarata, metodo trasparente</span><span><Radio size={17} /> Aggiornamenti quando ci sono novità</span></div>;
}
export function PageIntro({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return <div className="page-intro">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>;
}
export function AdPlaceholder() { return <div className="ad-placeholder"><span>SPAZIO PUBBLICITARIO</span><span>Annunci attualmente disattivati</span></div>; }
