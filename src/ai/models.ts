/**
 * AI provider + model resolution, per-model capabilities and price table
 * (ADR-0027). Pure functions: no I/O, no SDK import.
 */
import type { AiProviderSetting, Config } from '../config.js';
import { logger } from '../logger.js';

export type AiProvider = AiProviderSetting;

/** Model tier of a task: `fast` = high-volume classification (AI_MODEL_FAST). */
export type AiTier = 'default' | 'fast';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5',
  'github-models': 'openai/gpt-4.1',
};

/**
 * Effective provider. `AI_PROVIDER` wins; otherwise Anthropic as soon as
 * `ANTHROPIC_API_KEY` is set, else the historical GitHub Models path. Flipping
 * `AI_PROVIDER=github-models` is the rollback (no code change).
 */
export function resolveAiProvider(
  config: Pick<Config, 'AI_PROVIDER' | 'ANTHROPIC_API_KEY'>,
): AiProvider {
  if (config.AI_PROVIDER) return config.AI_PROVIDER;
  return config.ANTHROPIC_API_KEY ? 'anthropic' : 'github-models';
}

/** Native Anthropic model ids look like `claude-opus-5` (no vendor prefix). */
export function isAnthropicModelId(model: string): boolean {
  return /^claude-[a-z0-9.-]+$/.test(model);
}

const warnedForeignModels = new Set<string>();

/**
 * Model for a provider + tier. `AI_MODEL_FAST` falls back to `AI_MODEL`, which
 * falls back to the provider default. A model id from the OTHER provider's
 * family (e.g. a stored `openai/gpt-4.1` override after switching to
 * Anthropic, or `claude-opus-5` after rolling back) is ignored with a warning,
 * so flipping AI_PROVIDER alone is always a valid rollback.
 */
export function resolveAiModel(
  config: Pick<Config, 'AI_MODEL' | 'AI_MODEL_FAST'>,
  provider: AiProvider,
  tier: AiTier = 'default',
): string {
  const configured = (
    tier === 'fast' ? config.AI_MODEL_FAST || config.AI_MODEL : config.AI_MODEL
  )?.trim();
  if (!configured) return DEFAULT_MODELS[provider];
  const matches =
    provider === 'anthropic' ? isAnthropicModelId(configured) : !isAnthropicModelId(configured);
  if (matches) return configured;
  const key = `${provider}:${configured}`;
  if (!warnedForeignModels.has(key)) {
    warnedForeignModels.add(key);
    logger.warn('AI model ignored: not a model of the active provider', {
      provider,
      configured,
      using: DEFAULT_MODELS[provider],
    });
  }
  return DEFAULT_MODELS[provider];
}

export interface AnthropicModelCapabilities {
  /** `output_config.effort` accepted. */
  effort: boolean;
  /** `thinking: {type: 'adaptive'}` accepted. */
  adaptiveThinking: boolean;
  /** Server-side `fallbacks: "default"` (beta server-side-fallback-2026-07-01). */
  defaultFallbacks: boolean;
}

/**
 * Capabilities per the claude-api skill: effort + adaptive thinking on Opus
 * 4.6+ / Sonnet 4.6+ / Sonnet 5 / Opus 5.x / Fable; Haiku 4.5 has neither.
 * `fallbacks: "default"` is documented for Claude Opus 5, Opus 5.5 and
 * Fable 5.1 only; any other model handles `stop_reason: "refusal"` client-side.
 */
export function anthropicCapabilities(model: string): AnthropicModelCapabilities {
  const isHaiku = model.startsWith('claude-haiku');
  // Claude 4.5 and earlier: no adaptive thinking; effort omitted (conservative).
  const legacy = /^claude-(opus|sonnet)-4-[0-5]($|-)/.test(model);
  return {
    effort: !isHaiku && !legacy,
    adaptiveThinking: !isHaiku && !legacy,
    defaultFallbacks: ['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1'].includes(model),
  };
}

/** USD per million tokens. Source: platform.claude.com pricing (2026-10-10). */
export interface ModelPrice {
  input: number;
  cacheWrite5m: number;
  cacheRead: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, cacheWrite5m: 12.5, cacheRead: 0.25, output: 50 },
  'claude-fable-5': { input: 10, cacheWrite5m: 12.5, cacheRead: 1, output: 50 },
  'claude-opus-5-5': { input: 4, cacheWrite5m: 5, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-5': { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cacheWrite5m: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheWrite5m: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-4-5': { input: 3, cacheWrite5m: 3.75, cacheRead: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cacheWrite5m: 1.25, cacheRead: 0.1, output: 5 },
};

/** Unknown Claude model: price it like Claude Opus 5 (the default) and say so. */
const FALLBACK_PRICE = PRICES['claude-opus-5'];

/** Longest known id that prefixes `model` (handles dated ids like `claude-haiku-4-5-20251001`). */
export function priceForModel(model: string): { price: ModelPrice; known: boolean } {
  const key = Object.keys(PRICES)
    .filter((id) => model === id || model.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? { price: PRICES[key], known: true } : { price: FALLBACK_PRICE, known: false };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** Estimated USD cost of one Anthropic call (5-minute cache writes only). */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const { price } = priceForModel(model);
  const cost =
    (usage.inputTokens * price.input +
      usage.cacheCreationInputTokens * price.cacheWrite5m +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
