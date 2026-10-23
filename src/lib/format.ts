export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data non disponibile';
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric', ...options }).format(date);
}
export function formatTime(value: string | Date) {
  return formatDate(value, { day: undefined, month: undefined, year: undefined, hour: '2-digit', minute: '2-digit' });
}
export function fullDate(value: string) { return `${formatDate(value)}, ${formatTime(value)}`; }
export function isIndexableArticle(article: { originalContent: boolean; summary: string; context: string; citations: unknown[] }) {
  return article.originalContent && article.summary.length + article.context.length >= 300 && article.citations.length > 0;
}
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
