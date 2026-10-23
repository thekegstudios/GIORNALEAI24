import type { Article, Settings } from './types';
export type ModuleId = 'researcher' | 'verifier' | 'writer' | 'classifier' | 'chief' | 'updater' | 'seo' | 'analyst' | 'supervisor';
export type JobState = 'DISCOVERED' | 'NORMALIZED' | 'VERIFYING' | 'DRAFT' | 'REVIEW_REQUIRED' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'FAILED' | 'UPDATED' | 'RETRACTED';
export type VerificationState = 'CONFIRMED' | 'NEEDS_VERIFICATION' | 'DEVELOPING' | 'CONTRADICTED' | 'HUMAN_REVIEW';
export interface VerificationReport {
  status: VerificationState; checkedAt: string; explanation: string;
  checks: { name: string; passed: boolean; detail: string }[];
  claims: { text: string; status: VerificationState; evidence: { sourceId: string; url: string; itemHash: string; quote?: string }[] }[];
  independentOrigins: number | null;
  eventDate: string | null; eventDateEvidence: string | null;
  geography: { level: 'national' | 'region' | 'province' | 'municipality' | 'undetermined'; region: string | null; province: string | null; municipality: string | null; evidence: string | null };
}
export interface NewsroomJob {
  id: string; state: JobState; title: string; sourceId: string; sourceName: string;
  canonicalUrl: string; eventId: string | null; attempts: number; lastError: string | null;
  discoveredAt: string; sourcePublishedAt: string | null; updatedAt: string; availableAt: string;
  verification: VerificationReport | null;
}
export interface NewsroomAction { id: string; module: ModuleId; action: string; entityId: string | null; runId: string | null; details: Record<string, unknown>; at: string }
export interface NewsroomIncident { id: string; severity: 'info' | 'warning' | 'critical'; status: 'open' | 'resolved'; module: ModuleId; title: string; details: string; firstSeenAt: string; lastSeenAt: string; automaticAction: string | null }
export interface EditionEntry { articleId: string; score: number; reasons: string[]; pinned: boolean; position: number }
export interface HomepageEdition { generatedAt: string; entries: EditionEntry[] }
export interface BudgetOverview { day: string; month: string; spentTodayUsd: number; spentMonthUsd: number; dailyBudgetUsd: number; monthlyBudgetUsd: number; remainingTodayUsd: number; remainingMonthUsd: number; inputTokens: number; outputTokens: number; callsToday: number; callsMonth: number; webSearches: number; chatSpentTodayUsd: number; chatDailyBudgetUsd: number; warning: boolean }
export interface NewsroomOverview {
  settings: Settings;
  status: { active: boolean; safetyMode: boolean; workerOnline: boolean; lastHeartbeatAt: string | null; lastScanAt: string | null; nextScanAt: string | null; activeSources: number; sourcesInError: number; apiConfigured: boolean; currentRunId: string | null };
  modules: { id: ModuleId; name: string; description: string; mode: 'deterministic' | 'ai-assisted'; lastActionAt: string | null; status: 'ready' | 'working' | 'attention' | 'disabled' }[];
  queue: { counts: Partial<Record<JobState, number>>; jobs: NewsroomJob[] };
  editorial: { discoveredToday: number; verified: number; published: number; updatedToday: number; rejected: number; review: number; corrections: number };
  budget: BudgetOverview;
  actions: NewsroomAction[]; incidents: NewsroomIncident[];
  homepage: { edition: HomepageEdition | null; articles: Pick<Article, 'id' | 'slug' | 'title' | 'categories' | 'relevance'>[]; overrides: { articleId: string; position: number | null; excluded: boolean; reason: string }[] };
  analytics: { enabled: boolean; pageViews: number; uniqueVisitors: null; organicTraffic: null; adRevenue: null; topPages: { path: string; views: number; averageLoadMs: number | null }[]; categories: { name: string; views: number }[]; regions: { name: string; views: number }[] };
  links: { url: string; status: string; httpStatus: number | null; checkedAt: string }[];
}
export interface ChatAnswer { answer: string; mode: 'archive' | 'ai'; cached: boolean; citations: { articleId: string; title: string; articleUrl: string; sourceName: string; url: string; publishedAt: string | null }[]; uncertainties: string[]; generatedAt: string }
export interface ChatContext { articleId?: string; articleSlug?: string; articleIds?: string[]; sportEventId?: string }
export type ChatStreamEvent = { type: 'status'; mode: 'archive' | 'ai' } | { type: 'delta'; text: string } | { type: 'done'; response: ChatAnswer } | { type: 'error'; error: string };
