import type { BriefingItem } from './briefing-types';
export interface BriefingPreferences { region: string; province: string; municipality: string; categories: string[] }
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function composeBriefingLocalItems(items: BriefingItem[], nationalIds: string[], preferences: BriefingPreferences): BriefingItem[] {
  const equal = (left: string | null, right: string) => Boolean(left && right && normalize(left) === normalize(right));
  return items.filter(item => !nationalIds.includes(item.articleId))
    .map(item => ({ item, score: (equal(item.region, preferences.region) ? 40 : 0) + (equal(item.province, preferences.province) && equal(item.region, preferences.region) ? 60 : 0) + (equal(item.municipality, preferences.municipality) && equal(item.region, preferences.region) ? 100 : 0) + (item.categories.some(category => preferences.categories.includes(category)) ? 20 : 0) }))
    .filter(entry => entry.score > 0).sort((left, right) => right.score - left.score || right.item.score - left.item.score).slice(0, 3).map(entry => entry.item);
}
