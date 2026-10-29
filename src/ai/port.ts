import type { AiProvider, AiTier, TokenUsage } from './models.js';

export type AiProfile = 'classify' | 'generate' | 'report';

export interface AiTaskSpec {
  profile: AiProfile;
  tier: AiTier;
  essential: boolean;
  label: string;
}

export const AI_TASKS = {
  'veille.digest': {
    profile: 'report',
    tier: 'default',
    essential: true,
    label: 'Digest de veille',
  },
  'veille.triage': {
    profile: 'classify',
    tier: 'fast',
    essential: true,
    label: 'Tri des mentions',
  },
  'veille.monthly': {
    profile: 'report',
    tier: 'default',
    essential: false,
    label: 'Résumé mensuel',
  },
  'radar.score': {
    profile: 'classify',
    tier: 'fast',
    essential: false,
    label: 'Radar produit (scoring)',
  },
  'radar.report': {
    profile: 'report',
    tier: 'default',
    essential: false,
    label: 'Radar produit (rapport)',
  },
  'intent.analyze': {
    profile: 'generate',
    tier: 'default',
    essential: false,
    label: 'Analyse de signal',
  },
  'intent.replies': {
    profile: 'generate',
    tier: 'default',
    essential: false,
    label: 'Variantes de réponse',
  },
  'content.generate': {
    profile: 'generate',
    tier: 'default',
    essential: false,
    label: 'Studio : posts',
  },
  'content.thread': {
    profile: 'generate',
    tier: 'default',
    essential: false,
    label: 'Studio : threads',
  },
  'content.suggest': {
    profile: 'generate',
    tier: 'default',
    essential: false,
    label: 'Studio : suggestions',
  },
} as const satisfies Record<string, AiTaskSpec>;

export type AiTask = keyof typeof AI_TASKS;

export type JsonObjectSchema = { type: 'object'; [key: string]: unknown };

export interface AiRequest {
  task: AiTask;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  cacheSystem?: boolean;
}

export interface AiJsonRequest extends AiRequest {
  schema: JsonObjectSchema;
}

export interface AiCallUsage extends TokenUsage {
  provider: AiProvider;
  model: string;
  task: AiTask;
  stopReason: string | null;
  costUsd: number;
}

export interface AiPort {
  readonly provider: AiProvider;
  modelFor(task: AiTask): string;
  text(req: AiRequest): Promise<string>;
  json(req: AiJsonRequest): Promise<unknown>;
}

export type AiUsageRecorder = (usage: AiCallUsage) => void;
