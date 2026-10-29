import type { AiProviderSetting, Config } from '../config.js';
import { logger } from '../logger.js';

export type AiProvider = AiProviderSetting;

export type AiTier = 'default' | 'fast';

export const AI_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AI_EFFORT_LEVELS)[number];

export function isAiEffort(value: unknown): value is AiEffort {
  return typeof value === 'string' && (AI_EFFORT_LEVELS as readonly string[]).includes(value);
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  'github-models': 'openai/gpt-4.1',
};

export interface ModelPrice {
  input: number;
  cacheWrite5m: number;
  cacheRead: number;
  output: number;
}

const ALL_EFFORTS = AI_EFFORT_LEVELS;
const NO_XHIGH = ['low', 'medium', 'high', 'max'] as const;
const BASIC_EFFORTS = ['low', 'medium', 'high'] as const;

export interface AnthropicModelSpec {
  id: string;
  label: string;
  current: boolean;
  price: ModelPrice;
  longContext?: { thresholdTokens: number; price: ModelPrice };
  effortLevels: readonly AiEffort[];
  defaultEffort?: AiEffort;
  adaptiveThinking: boolean;
  thinkingOnByDefault: boolean;
  serverSideFallback: boolean;
  minCacheTokens: number;
}

export const ANTHROPIC_MODELS: readonly AnthropicModelSpec[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    current: true,
    price: { input: 0.1, cacheWrite5m: 0.125, cacheRead: 0.01, output: 0.5 },
    longContext: {
      thresholdTokens: 100_000,
      price: { input: 0.5, cacheWrite5m: 0.625, cacheRead: 0.05, output: 2.5 },
    },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'medium',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: false,
    minCacheTokens: 512,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    current: true,
    price: { input: 2, cacheWrite5m: 2.5, cacheRead: 0.1, output: 10 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: true,
    minCacheTokens: 512,
  },
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    current: true,
    price: { input: 4, cacheWrite5m: 5, cacheRead: 0.2, output: 20 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'medium',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: true,
    minCacheTokens: 512,
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    current: true,
    price: { input: 10, cacheWrite5m: 12.5, cacheRead: 0.25, output: 50 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: true,
    minCacheTokens: 512,
  },
  {
    id: 'claude-fable-5',
    label: 'Claude Fable 5',
    current: false,
    price: { input: 10, cacheWrite5m: 12.5, cacheRead: 1, output: 50 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: true,
    minCacheTokens: 512,
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    current: false,
    price: { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: true,
    minCacheTokens: 512,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    current: false,
    price: { input: 2, cacheWrite5m: 2.5, cacheRead: 0.2, output: 10 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: true,
    serverSideFallback: false,
    minCacheTokens: 1024,
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    current: false,
    price: { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 1024,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    current: false,
    price: { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 2048,
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    current: false,
    price: { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
    effortLevels: NO_XHIGH,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 4096,
  },
  {
    id: 'claude-opus-4-5',
    label: 'Claude Opus 4.5',
    current: false,
    price: { input: 5, cacheWrite5m: 6.25, cacheRead: 0.5, output: 25 },
    effortLevels: BASIC_EFFORTS,
    defaultEffort: 'high',
    adaptiveThinking: false,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 4096,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    current: false,
    price: { input: 3, cacheWrite5m: 3.75, cacheRead: 0.3, output: 15 },
    effortLevels: NO_XHIGH,
    defaultEffort: 'high',
    adaptiveThinking: true,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 1024,
  },
  {
    id: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    current: false,
    price: { input: 3, cacheWrite5m: 3.75, cacheRead: 0.3, output: 15 },
    effortLevels: [],
    adaptiveThinking: false,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 1024,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    current: false,
    price: { input: 1, cacheWrite5m: 1.25, cacheRead: 0.1, output: 5 },
    effortLevels: [],
    adaptiveThinking: false,
    thinkingOnByDefault: false,
    serverSideFallback: false,
    minCacheTokens: 4096,
  },
];

export const ANTHROPIC_MODEL_ID_PATTERN = /^claude-[a-z0-9-]+$/;

export function findAnthropicModel(model: string): AnthropicModelSpec | undefined {
  return ANTHROPIC_MODELS.find(
    (m) =>
      model === m.id ||
      (model.startsWith(`${m.id}-`) && /^\d{8}$/.test(model.slice(m.id.length + 1))),
  );
}

export function resolveAiProvider(
  config: Pick<Config, 'AI_PROVIDER' | 'ANTHROPIC_API_KEY'>,
): AiProvider {
  if (config.AI_PROVIDER) return config.AI_PROVIDER;
  return config.ANTHROPIC_API_KEY ? 'anthropic' : 'github-models';
}

export function isAnthropicModelId(model: string): boolean {
  return /^claude-[a-z0-9.-]+$/.test(model);
}

export interface AiModelSettings {
  AI_MODEL?: string;
  AI_MODEL_FAST?: string;
  AI_EFFORT?: string;
  AI_EFFORT_FAST?: string;
}

export type AiSettingSource = 'settings' | 'env' | 'default';

export interface AiSelection {
  model: string;
  modelSource: AiSettingSource;
  effort?: AiEffort;
  effortSource: AiSettingSource;
}

export type AiEnvConfig = Partial<
  Pick<Config, 'AI_MODEL' | 'AI_MODEL_FAST' | 'AI_EFFORT' | 'AI_EFFORT_FAST'>
>;

const warned = new Set<string>();

function warnOnce(key: string, message: string, meta: Record<string, unknown>): void {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(message, meta);
}

export function resolveAiSelection(
  config: AiEnvConfig,
  settings: AiModelSettings,
  provider: AiProvider,
  tier: AiTier = 'default',
): AiSelection {
  const modelKey = tier === 'fast' ? 'AI_MODEL_FAST' : 'AI_MODEL';
  const effortKey = tier === 'fast' ? 'AI_EFFORT_FAST' : 'AI_EFFORT';
  const layers = (key: keyof AiModelSettings) =>
    [
      ['settings', settings[key]],
      ['env', config[key]],
    ] as const;

  let model: string | undefined;
  let modelSource: AiSettingSource = 'default';
  for (const [source, raw] of layers(modelKey)) {
    const value = raw?.trim();
    if (!value) continue;
    const matches =
      provider === 'anthropic' ? isAnthropicModelId(value) : !isAnthropicModelId(value);
    if (matches) {
      model = value;
      modelSource = source;
      break;
    }
    warnOnce(
      `${provider}:${source}:${value}`,
      'AI model ignored: not a model of the active provider',
      {
        provider,
        source,
        key: modelKey,
        configured: value,
      },
    );
  }
  if (!model) {
    if (tier === 'fast' && provider === 'github-models') {
      ({ model, modelSource } = resolveAiSelection(config, settings, provider, 'default'));
    } else {
      model = DEFAULT_MODELS[provider];
    }
  }

  let effort: AiEffort | undefined;
  let effortSource: AiSettingSource = 'default';
  for (const [source, raw] of layers(effortKey)) {
    const value = raw?.trim();
    if (!value) continue;
    if (isAiEffort(value)) {
      effort = value;
      effortSource = source;
      break;
    }
    warnOnce(`effort:${source}:${value}`, 'AI effort ignored: unknown value', {
      source,
      key: effortKey,
      configured: value,
    });
  }

  return { model, modelSource, effort, effortSource };
}

export function resolveAiModel(
  config: AiEnvConfig,
  provider: AiProvider,
  tier: AiTier = 'default',
  settings: AiModelSettings = {},
): string {
  return resolveAiSelection(config, settings, provider, tier).model;
}

export interface AnthropicModelCapabilities {
  effortLevels: readonly AiEffort[];
  adaptiveThinking: boolean;
  defaultFallbacks: boolean;
}

export function anthropicCapabilities(model: string): AnthropicModelCapabilities {
  const spec = findAnthropicModel(model);
  if (!spec) return { effortLevels: [], adaptiveThinking: false, defaultFallbacks: false };
  return {
    effortLevels: spec.effortLevels,
    adaptiveThinking: spec.adaptiveThinking,
    defaultFallbacks: spec.serverSideFallback,
  };
}

function fallbackSpec(model: string): AnthropicModelSpec {
  const family = /^claude-(haiku|sonnet|opus|fable|mythos)/.exec(model)?.[1] ?? '';
  const byFamily: Record<string, string> = {
    haiku: 'claude-haiku-5-5',
    sonnet: 'claude-sonnet-5-5',
    opus: 'claude-opus-5',
    fable: 'claude-fable-5-1',
    mythos: 'claude-fable-5-1',
  };
  return findAnthropicModel(byFamily[family] ?? 'claude-fable-5-1')!;
}

export function priceForModel(model: string): {
  price: ModelPrice;
  longContext?: AnthropicModelSpec['longContext'];
  known: boolean;
} {
  const spec = findAnthropicModel(model);
  const used = spec ?? fallbackSpec(model);
  return { price: used.price, longContext: used.longContext, known: Boolean(spec) };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const { price: base, longContext } = priceForModel(model);
  const promptTokens =
    usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  const price =
    longContext && promptTokens > longContext.thresholdTokens ? longContext.price : base;
  const cost =
    (usage.inputTokens * price.input +
      usage.cacheCreationInputTokens * price.cacheWrite5m +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000;
  return Math.round(cost * 1e9) / 1e9;
}
