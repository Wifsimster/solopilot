/**
 * The AI port (ADR-0027): one interface, two adapters (Anthropic, GitHub
 * Models / OpenAI-compatible). Business code depends on this file only.
 */
import type { AiProvider, AiTier, TokenUsage } from './models.js';

/**
 * Task profile, mapped per adapter:
 * - `classify`: high-volume scoring/classification (low effort, no explicit thinking)
 * - `generate`: short creative output on user request (medium effort)
 * - `report`: digests and syntheses that benefit from reasoning (adaptive thinking, high effort)
 */
export type AiProfile = 'classify' | 'generate' | 'report';

export interface AiTaskSpec {
  profile: AiProfile;
  tier: AiTier;
  /**
   * Essential tasks keep running once the monthly budget is exhausted;
   * every other task is refused (AiError 'budget_exceeded').
   */
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

/** A JSON Schema whose root is an object (structured-output contract). */
export type JsonObjectSchema = { type: 'object'; [key: string]: unknown };

export interface AiRequest {
  task: AiTask;
  /** Stable instructions. Keep volatile data (dates, ids) in `user`. */
  system: string;
  user: string;
  /** Budget for the visible answer; adapters add thinking headroom when relevant. */
  maxTokens: number;
  timeoutMs: number;
  /** Mark the system prompt cacheable (prefix repeats within 5 minutes). */
  cacheSystem?: boolean;
}

export interface AiJsonRequest extends AiRequest {
  /** Output contract. Callers still validate the result with their Zod schema. */
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
  /** Model a task would run on (for logs / UI). */
  modelFor(task: AiTask): string;
  /** Free text answer (trimmed). */
  text(req: AiRequest): Promise<string>;
  /** Parsed JSON answer, NOT yet validated: run it through the caller's Zod schema. */
  json(req: AiJsonRequest): Promise<unknown>;
}

/** Usage sink (SQLite in production; injectable in tests). */
export type AiUsageRecorder = (usage: AiCallUsage) => void;
