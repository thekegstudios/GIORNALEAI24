export type Category = 'cronaca' | 'politica' | 'economia' | 'lavoro' | 'salute' | 'scuola' | 'tecnologia' | 'sport' | 'spettacolo' | 'ambiente' | 'meteo' | 'trasporti' | 'giustizia' | 'eventi';
export type EditorialStatus = 'published' | 'review' | 'rejected' | 'withdrawn';
export interface Citation {
  sourceId: string; sourceName: string; url: string; title: string;
  publishedAt: string | null; checkedAt: string; license: string; termsUrl: string;
}
export interface Article {
  id: string; slug: string; title: string; summary: string; context: string;
  categories: Category[]; region: string | null; province: string | null; municipality: string | null;
  locationEvidence: string | null; relevance: number; status: EditorialStatus;
  publishedAt: string; updatedAt: string; confirmed: string[]; unconfirmed: string[];
  explanations: { simple: string; detailed: string; causes: string; consequences: string; practical: string };
  citations: Citation[]; timeline: { at: string; text: string }[];
  reviewReasons: string[]; aiGenerated: boolean; originalContent: boolean;
  verification?: import('./newsroom-types').VerificationReport;
  seo?: { title: string; description: string; indexable: boolean; issues: string[] };
}
export interface Source {
  id: string; name: string; homepage: string; feedUrl: string | null;
  enabled: boolean; authorized: boolean; license: string; termsUrl: string;
  allowSummary: boolean; official: boolean; region: string | null;
  lastCheckedAt: string | null; lastSuccessAt: string | null; lastError: string | null;
  territory?: { unitId: string; evidenceUrl: string };
}
export interface Settings {
  paused: boolean; intervalMinutes: number; aiModel: string; dailyBudgetUsd: number;
  maxItemsPerRun: number; autoPublish: boolean;
  monthlyBudgetUsd?: number; chatDailyBudgetUsd?: number; chatEnabled?: boolean; safetyMode?: boolean;
}
export interface RunResult {
  id: string; startedAt: string; finishedAt: string | null;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'skipped';
  imported: number; published: number; review: number; duplicates: number;
  errors: string[]; inputTokens: number; outputTokens: number; estimatedCostUsd: number;
}
export interface PipelineStatus {
  lastRun: RunResult | null; activeSources: number; totalPublished: number;
  aiConfigured: boolean; paused: boolean; intervalMinutes: number;
}
export interface DailyDigest { date: string; generatedAt: string; items: { id: string; slug: string; title: string; summary: string }[] }
export interface Correction { id: string; articleId: string; slug: string; title: string; at: string; reason: string; previousTitle: string; newTitle: string }
export interface NewsFilters { category?: string; region?: string; province?: string; municipality?: string; query?: string; limit?: number; status?: EditorialStatus }
export interface AdminData {
  articles: Article[]; sources: Source[]; runs: RunResult[]; settings: Settings;
  metrics: { collectedToday: number; published: number; review: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; pageViews: number };
}
