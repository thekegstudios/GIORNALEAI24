import type { Category, Citation } from './types';

export interface BriefingSettings {
  enabled: boolean;
  scheduledTime: string;
  regenerationMinutes: number;
  relevanceThreshold: number;
  lookbackHours: number;
  audioEnabled: boolean;
}
export interface BriefingItem {
  articleId: string; slug: string; title: string; summary: string; context: string;
  category: Category; categories: Category[];
  region: string | null; province: string | null; municipality: string | null;
  sourcePublishedAt: string; eventDate: string | null;
  citations: Citation[]; sourceVersion: string; reasons: string[]; score: number;
}
export interface BriefingClaim { text: string; articleIds: string[] }
export interface Briefing {
  id: string; day: string; version: number;
  state: 'published' | 'review' | 'withdrawn';
  mode: 'archive' | 'ai' | 'editorial';
  summary: string; claims: BriefingClaim[]; items: BriefingItem[];
  fingerprint: string; reason: string; createdAt: string; publishedAt: string | null;
  estimatedCostUsd: number; warnings: string[];
  controls: { referenceIntegrity: boolean; semanticReviewRequired: boolean; approvedBy: string | null; approvedAt: string | null };
  audio: { state: 'not_configured' | 'pending' | 'ready' | 'failed'; url: string | null };
}
export interface BriefingRun {
  id: string; day: string; state: string; briefingId: string | null;
  reason: string; error: string | null; estimatedCostUsd: number; createdAt: string;
}
export interface BriefingHomeData {
  briefing: Briefing | null; localItems: BriefingItem[];
  availability: 'ready' | 'unavailable'; message: string;
}
export interface BriefingAdminData {
  settings: BriefingSettings; latest: Briefing | null;
  versions: Briefing[]; runs: BriefingRun[];
  aiConfigured: boolean; eligibleArticles: number;
}
