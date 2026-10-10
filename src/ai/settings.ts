/**
 * AI model/effort selection from the Settings page (ADR-0027).
 *
 * Settings > env > code default, per class. Every AI call reads the Settings
 * layer live through `createAi()`, so a change applies to the next call of
 * every feature (digest, triage, radar, intent, studio) without a restart.
 */
import { AI_SELECTION_SETTING_KEYS, type AiSelectionSettingKey, type Config } from '../config.js';
import { deleteSetting, getSetting, setSetting } from '../settings-service.js';
import { logger } from '../logger.js';
import {
  ANTHROPIC_MODEL_ID_PATTERN,
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  AI_EFFORT_LEVELS,
  findAnthropicModel,
  isAiEffort,
  priceForModel,
  resolveAiProvider,
  resolveAiSelection,
  type AiEffort,
  type AiModelSettings,
  type AiProvider,
  type AiSettingSource,
  type AiTier,
} from './models.js';

export function isAiSelectionSettingKey(key: string): key is AiSelectionSettingKey {
  return (AI_SELECTION_SETTING_KEYS as readonly string[]).includes(key);
}

/** Current Settings values (DB). A DB failure degrades to "no override". */
export function readAiModelSettings(): AiModelSettings {
  try {
    const out: AiModelSettings = {};
    for (const key of AI_SELECTION_SETTING_KEYS) {
      const value = getSetting(key)?.trim();
      if (value) out[key] = value;
    }
    return out;
  } catch (err) {
    logger.warn('AI settings unreadable, using env/defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

const MODEL_KEY: Record<AiTier, AiSelectionSettingKey> = {
  default: 'AI_MODEL',
  fast: 'AI_MODEL_FAST',
};
const EFFORT_KEY: Record<AiTier, AiSelectionSettingKey> = {
  default: 'AI_EFFORT',
  fast: 'AI_EFFORT_FAST',
};
const CLASS_LABEL: Record<AiTier, string> = {
  default: 'Modèle principal',
  fast: 'Modèle rapide',
};

export type AiSettingsValidation =
  | { ok: true; updates: Partial<Record<AiSelectionSettingKey, string>> }
  | { ok: false; message: string };

/**
 * Validates the AI keys of a POST /api/settings body. `''` clears an
 * override. Model ids must match `^claude-[a-z0-9-]+$`; an effort must be a
 * level the class's effective model (after this update) accepts.
 */
export function validateAiSettingsUpdate(
  body: Record<string, unknown>,
  config: Partial<Config>,
  current: AiModelSettings,
): AiSettingsValidation {
  const updates: Partial<Record<AiSelectionSettingKey, string>> = {};
  for (const key of AI_SELECTION_SETTING_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (typeof raw !== 'string') {
      return { ok: false, message: `Valeur invalide pour ${key} (texte attendu).` };
    }
    const value = raw.trim();
    if (value && (key === 'AI_MODEL' || key === 'AI_MODEL_FAST')) {
      if (value.length > 100 || !ANTHROPIC_MODEL_ID_PATTERN.test(value)) {
        return {
          ok: false,
          message: `Identifiant de modèle invalide pour ${key} : attendu un ID Anthropic du type claude-haiku-5-5 (minuscules, chiffres et tirets).`,
        };
      }
    }
    if (value && (key === 'AI_EFFORT' || key === 'AI_EFFORT_FAST') && !isAiEffort(value)) {
      return {
        ok: false,
        message: `Effort invalide pour ${key} (valeurs possibles : ${AI_EFFORT_LEVELS.join(', ')}, ou vide pour le réglage par tâche).`,
      };
    }
    updates[key] = value;
  }

  // Effort vs the model the class will run on once this update is applied.
  const next: AiModelSettings = { ...current };
  for (const [key, value] of Object.entries(updates) as [AiSelectionSettingKey, string][]) {
    if (value) next[key] = value;
    else delete next[key];
  }
  for (const tier of ['default', 'fast'] as const) {
    const selection = resolveAiSelection(config, next, 'anthropic', tier);
    if (!selection.effort || selection.effortSource !== 'settings') continue;
    const spec = findAnthropicModel(selection.model);
    if (!spec || !spec.effortLevels.includes(selection.effort)) {
      const accepted = spec?.effortLevels.length ? spec.effortLevels.join(', ') : 'aucun';
      return {
        ok: false,
        message: `${CLASS_LABEL[tier]} : ${selection.model} n'accepte pas l'effort « ${selection.effort} » (efforts acceptés : ${accepted}).`,
      };
    }
  }
  return { ok: true, updates };
}

/** Persists validated updates: a value is stored, `''` deletes the override. */
export function applyAiSettingsUpdate(
  updates: Partial<Record<AiSelectionSettingKey, string>>,
): number {
  let n = 0;
  for (const [key, value] of Object.entries(updates) as [AiSelectionSettingKey, string][]) {
    if (value) setSetting(key, value);
    else deleteSetting(key);
    n++;
  }
  return n;
}

const usd = (n: number) =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 3 })} $`;

/** Short price for the dropdown: "dès 0,1 $ / 0,5 $" when prices are tiered. */
function priceShort(model: string): string {
  const { price, longContext } = priceForModel(model);
  return `${longContext ? 'dès ' : ''}${usd(price.input)} / ${usd(price.output)} par MTok`;
}

/** Full price line: input / output per MTok, plus the long-prompt tier. */
function priceHint(model: string): string {
  const { price, longContext, known } = priceForModel(model);
  const base = `${usd(price.input)} entrée / ${usd(price.output)} sortie par MTok`;
  const tier = longContext
    ? ` jusqu'à ${longContext.thresholdTokens.toLocaleString('fr-FR')} tokens de prompt, ${usd(longContext.price.input)} / ${usd(longContext.price.output)} au-delà`
    : '';
  return `${known ? '' : 'ID hors catalogue, coût estimé au tarif de la famille : '}${base}${tier}`;
}

export interface AiModelOption {
  id: string;
  label: string;
  priceShort: string;
  priceHint: string;
  effortLevels: AiEffort[];
  defaultEffort: AiEffort | null;
}

export interface AiClassView {
  /** Value stored in Settings ('' = none). */
  setting: string;
  effortSetting: string;
  /** Env value ('' = none), shown so the UI can explain the fallback. */
  env: string;
  model: string;
  modelSource: AiSettingSource;
  /** Effective effort override (null = per-task default). */
  effort: AiEffort | null;
  effortSource: AiSettingSource;
  /** Catalogue entry of the effective model (null = custom id). */
  known: boolean;
  effortLevels: AiEffort[];
  priceHint: string;
}

export interface AiModelsView {
  provider: AiProvider;
  /** Code default of both classes on Anthropic. */
  defaultModel: string;
  catalogue: AiModelOption[];
  classes: Record<AiTier, AiClassView>;
}

/** Catalogue + effective selection per class, for the Settings page. */
export function getAiModelsView(
  config: Partial<Config>,
  settings: AiModelSettings = readAiModelSettings(),
): AiModelsView {
  const provider = resolveAiProvider(config as Config);
  const classView = (tier: AiTier): AiClassView => {
    const s = resolveAiSelection(config, settings, provider, tier);
    const spec = provider === 'anthropic' ? findAnthropicModel(s.model) : undefined;
    return {
      setting: settings[MODEL_KEY[tier]] ?? '',
      effortSetting: settings[EFFORT_KEY[tier]] ?? '',
      env: config[MODEL_KEY[tier]]?.trim() ?? '',
      model: s.model,
      modelSource: s.modelSource,
      effort: s.effort ?? null,
      effortSource: s.effortSource,
      known: Boolean(spec),
      effortLevels: [...(spec?.effortLevels ?? [])],
      priceHint: provider === 'anthropic' ? priceHint(s.model) : 'GitHub Models : gratuit',
    };
  };
  return {
    provider,
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    catalogue: ANTHROPIC_MODELS.filter((m) => m.current).map((m) => ({
      id: m.id,
      label: m.label,
      priceShort: priceShort(m.id),
      priceHint: priceHint(m.id),
      effortLevels: [...m.effortLevels],
      defaultEffort: m.defaultEffort ?? null,
    })),
    classes: { default: classView('default'), fast: classView('fast') },
  };
}
