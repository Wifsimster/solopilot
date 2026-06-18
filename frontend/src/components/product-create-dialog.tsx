import { useReducer, useRef, useState, type Ref } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ChipInput, type ChipInputHandle, type ChipParseResult } from './chip-input';
import { SubredditPicker, type SubredditPickerHandle } from './subreddit-picker';
import type { ContentLanguage, ContentVoice, ProductRecord, ReplyVoice } from '@/types';

const PRODUCT_DESCRIPTION_MAX = 2000;
const REPLY_VOICE_DEFAULT_LABEL = 'Par défaut (professionnelle)';
const REPLY_VOICE_OPTIONS: { value: ReplyVoice; label: string }[] = [
  { value: 'decontractee', label: 'Décontractée' },
  { value: 'professionnelle', label: 'Professionnelle' },
  { value: 'directe', label: 'Directe' },
  { value: 'aidante', label: 'Aidante' },
];
const REPLY_VOICE_VALUES: ReplyVoice[] = REPLY_VOICE_OPTIONS.map((o) => o.value);
const REPLY_VOICE_NONE = '__none__';

const TARGET_AUDIENCE_MAX = 500;
const VALUE_PROP_MIN = 3;
const VALUE_PROP_MAX = 200;
const VALUE_PROPS_MAX = 10;
const CTA_MIN = 3;
const CTA_MAX = 200;
const CTAS_MAX = 5;
const CONTENT_VOICE_DEFAULT_LABEL = 'Par défaut (professionnelle)';
const CONTENT_VOICE_OPTIONS: { value: ContentVoice; label: string }[] = [
  { value: 'decontractee', label: 'Décontractée' },
  { value: 'professionnelle', label: 'Professionnelle' },
  { value: 'directe', label: 'Directe' },
  { value: 'aidante', label: 'Aidante' },
];
const CONTENT_VOICE_VALUES: ContentVoice[] = CONTENT_VOICE_OPTIONS.map((o) => o.value);
const CONTENT_VOICE_NONE = '__none__';
const CONTENT_LANGUAGE_OPTIONS: { value: ContentLanguage; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
];
const CONTENT_LANGUAGE_VALUES: ContentLanguage[] = CONTENT_LANGUAGE_OPTIONS.map((o) => o.value);

type DialogMode = 'create' | 'edit';

interface ProductCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (product: ProductRecord) => void;
  onUpdated?: (product: ProductRecord) => void;
  mode?: DialogMode;
  initialValues?: ProductRecord | null;
}

const HN_KEYWORD_MIN = 2;
const HN_KEYWORD_MAX = 64;
const HN_KEYWORDS_MAX = 20;
const INTENT_KEYWORD_MIN = 2;
const INTENT_KEYWORD_MAX = 128;
const INTENT_KEYWORDS_MAX = 30;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Parse + validate factory for a length-bounded keyword/phrase chip field. The
 * returned function splits on commas/newlines, trims, and enforces the
 * min/max-length bounds, producing a French error message on violation.
 */
function makeLengthParser(
  min: number,
  max: number,
  labelShort: (joined: string) => string,
  labelLong: (joined: string) => string,
): (raw: string) => ChipParseResult {
  return (raw: string) => {
    const tokens = raw.split(/[,\n]+/).flatMap((t) => {
      const trimmed = t.trim();
      return trimmed ? [trimmed] : [];
    });
    if (tokens.length === 0) return { ok: true, tokens: [] };
    const tooShort = tokens.filter((t) => t.length < min);
    if (tooShort.length > 0) return { ok: false, error: labelShort(tooShort.join(', ')) };
    const tooLong = tokens.filter((t) => t.length > max);
    if (tooLong.length > 0) return { ok: false, error: labelLong(tooLong.join(', ')) };
    return { ok: true, tokens };
  };
}

const parseHnKeywords = makeLengthParser(
  HN_KEYWORD_MIN,
  HN_KEYWORD_MAX,
  (j) => `Mot-clé trop court : ${j} (min ${HN_KEYWORD_MIN} caractères).`,
  (j) => `Mot-clé trop long : ${j} (max ${HN_KEYWORD_MAX} caractères).`,
);
const parseIntentKeywords = makeLengthParser(
  INTENT_KEYWORD_MIN,
  INTENT_KEYWORD_MAX,
  (j) => `Mot-clé trop court : ${j} (min ${INTENT_KEYWORD_MIN} caractères).`,
  (j) => `Mot-clé trop long : ${j} (max ${INTENT_KEYWORD_MAX} caractères).`,
);
const parseValueProps = makeLengthParser(
  VALUE_PROP_MIN,
  VALUE_PROP_MAX,
  (j) => `Proposition trop courte : ${j} (min ${VALUE_PROP_MIN} caractères).`,
  (j) => `Proposition trop longue : ${j} (max ${VALUE_PROP_MAX} caractères).`,
);
const parseCtas = makeLengthParser(
  CTA_MIN,
  CTA_MAX,
  (j) => `CTA trop court : ${j} (min ${CTA_MIN} caractères).`,
  (j) => `CTA trop long : ${j} (max ${CTA_MAX} caractères).`,
);

/** POST a suggestion request and pull the typed value out, or null on any failure. */
async function postSuggestion<T>(
  endpoint: string,
  body: Record<string, unknown>,
  extract: (data: Record<string, unknown>) => T | null | undefined,
): Promise<T | null> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) return null;
    const value = extract(data);
    return value === null || value === undefined ? null : value;
  } catch {
    return null;
  }
}

/**
 * Drives the single "Tout générer avec l'IA" action: fills every generatable
 * field from the product name (+ optional URL) in one click. Suggestions feed
 * each other, so the foundation fields (description → audience → value props)
 * are generated sequentially and threaded through a local accumulator — React
 * state updates are async and wouldn't be visible to the next call — then the
 * dependent fields (subreddits, HN keywords, CTAs, intent phrases) run in
 * parallel off that foundation. Failures are collected per field so a single
 * endpoint error doesn't abort the rest.
 */
function useGenerateAll(
  state: FormState,
  set: Setter,
): { generating: boolean; generateAll: () => Promise<void> } {
  const [generating, setGenerating] = useState(false);

  const generateAll = async () => {
    const name = state.name.trim();
    if (!name) {
      toast.error('Renseigne le nom du produit avant de générer avec l’IA.');
      return;
    }
    setGenerating(true);
    const language = state.contentLanguage ?? 'fr';
    const url = state.productUrl.trim() || null;
    // Seed from anything the user already typed so existing input informs the AI.
    const acc = {
      description: state.productDescription.trim(),
      audience: state.targetAudience.trim(),
      valueProps: state.valueProps,
    };
    const failed: string[] = [];

    try {
      // --- Foundation: sequential, each builds on the previous result ---
      const description = await postSuggestion<string>(
        '/api/content/suggest-description',
        {
          name,
          product_url: url,
          target_audience: acc.audience || null,
          value_props: acc.valueProps,
          content_language: language,
        },
        (d) => (typeof d.product_description === 'string' ? d.product_description : null),
      );
      if (description) {
        acc.description = description.slice(0, PRODUCT_DESCRIPTION_MAX);
        set('productDescription', acc.description);
      } else {
        failed.push('description');
      }

      const audience = await postSuggestion<string>(
        '/api/content/suggest-audience',
        {
          name,
          product_url: url,
          product_description: acc.description || null,
          value_props: acc.valueProps,
          content_language: language,
        },
        (d) => (typeof d.target_audience === 'string' ? d.target_audience : null),
      );
      if (audience) {
        acc.audience = audience.slice(0, TARGET_AUDIENCE_MAX);
        set('targetAudience', acc.audience);
      } else {
        failed.push('audience cible');
      }

      const valueProps = await postSuggestion<string[]>(
        '/api/content/suggest-value-props',
        {
          name,
          product_url: url,
          product_description: acc.description || null,
          target_audience: acc.audience || null,
          content_language: language,
        },
        (d) => (Array.isArray(d.value_props) ? (d.value_props as string[]) : null),
      );
      if (valueProps) {
        acc.valueProps = valueProps.slice(0, VALUE_PROPS_MAX);
        set('valueProps', acc.valueProps);
      } else {
        failed.push('propositions de valeur');
      }

      // --- Dependent fields: parallel, off the freshly built foundation ---
      const sourceCtx = {
        name,
        product_url: url,
        product_description: acc.description || null,
        target_audience: acc.audience || null,
        content_language: language,
      };

      await Promise.all([
        (async () => {
          const subreddits = await postSuggestion<string[]>(
            '/api/content/suggest-subreddits',
            sourceCtx,
            (d) => (Array.isArray(d.subreddits) ? (d.subreddits as string[]) : null),
          );
          if (subreddits) {
            set('subreddits', subreddits);
            set('redditEnabled', true);
          } else {
            failed.push('subreddits');
          }
        })(),
        (async () => {
          const keywords = await postSuggestion<string[]>(
            '/api/content/suggest-hn-keywords',
            sourceCtx,
            (d) => (Array.isArray(d.keywords) ? (d.keywords as string[]) : null),
          );
          if (keywords) {
            set('hnKeywords', keywords.slice(0, HN_KEYWORDS_MAX));
            set('hnEnabled', true);
          } else {
            failed.push('mots-clés Hacker News');
          }
        })(),
        (async () => {
          const ctas = await postSuggestion<string[]>(
            '/api/content/suggest-ctas',
            { ...sourceCtx, value_props: acc.valueProps },
            (d) => (Array.isArray(d.call_to_actions) ? (d.call_to_actions as string[]) : null),
          );
          if (ctas) {
            set('callToActions', ctas.slice(0, CTAS_MAX));
          } else {
            failed.push('calls to action');
          }
        })(),
        (async () => {
          const intent = await postSuggestion<string[]>(
            '/api/content/suggest-intent-keywords',
            sourceCtx,
            (d) => (Array.isArray(d.intent_keywords) ? (d.intent_keywords as string[]) : null),
          );
          if (intent) {
            set('intentKeywords', intent.slice(0, INTENT_KEYWORDS_MAX));
            set('intentEnabled', true);
          } else {
            failed.push("mots-clés d'intention");
          }
        })(),
      ]);
    } finally {
      setGenerating(false);
    }

    if (failed.length === 0) {
      toast.success("Tous les champs ont été générés par l'IA.");
    } else if (failed.length >= 7) {
      toast.error("Échec de la génération IA. Vérifie le nom du produit et réessaie.");
    } else {
      toast.warning(`Champs générés. Non générés : ${failed.join(', ')}.`);
    }
  };

  return { generating, generateAll };
}

/** Prominent single-click "fill every field with AI" control. */
function GenerateAllButton({ generating, onClick }: { generating: boolean; onClick: () => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Génération assistée par l'IA</h3>
          <p className="text-xs text-muted-foreground">
            Remplit en une fois la description, l'audience, les propositions de valeur, les CTA, les
            sources (subreddits, mots-clés HN) et les mots-clés d'intention à partir du nom et de
            l'URL.
          </p>
        </div>
        <Button type="button" className="gap-1.5 shrink-0" onClick={onClick} disabled={generating}>
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {generating ? 'Génération...' : "Tout générer avec l'IA"}
        </Button>
      </div>
    </div>
  );
}

interface FormState {
  name: string;
  id: string;
  xEnabled: boolean;
  xQuery: string;
  redditEnabled: boolean;
  subreddits: string[];
  hnEnabled: boolean;
  hnKeywords: string[];
  intentEnabled: boolean;
  intentKeywords: string[];
  intentExcludeKeywords: string[];
  intentRequireKeywords: string[];
  discordWebhook: string;
  aiPromptOverride: string;
  productDescription: string;
  replyVoice: ReplyVoice | null;
  productUrl: string;
  productionUrl: string;
  targetAudience: string;
  valueProps: string[];
  callToActions: string[];
  contentVoice: ContentVoice | null;
  contentLanguage: ContentLanguage | null;
  submitting: boolean;
  error: string | null;
}

type FormAction = {
  [K in keyof FormState]: { type: 'set'; field: K; value: FormState[K] };
}[keyof FormState];

function formReducer(state: FormState, action: FormAction): FormState {
  return { ...state, [action.field]: action.value };
}

function buildInitialFormState(initialValues: ProductRecord | null): FormState {
  return {
    name: initialValues?.name ?? '',
    id: initialValues?.id ?? '',
    xEnabled: initialValues?.x_enabled ?? true,
    xQuery: initialValues?.x_query ?? '',
    redditEnabled: initialValues?.reddit_enabled ?? false,
    subreddits: initialValues?.reddit_subreddits ?? [],
    hnEnabled: initialValues?.hn_enabled ?? false,
    hnKeywords: initialValues?.hn_keywords ?? [],
    intentEnabled: initialValues?.intent_enabled ?? false,
    intentKeywords: initialValues?.intent_keywords ?? [],
    intentExcludeKeywords: initialValues?.intent_exclude_keywords ?? [],
    intentRequireKeywords: initialValues?.intent_require_keywords ?? [],
    // discord_webhook is masked from backend — leave blank so user can re-enter
    // only if changing.
    discordWebhook: '',
    aiPromptOverride: initialValues?.ai_prompt_override ?? '',
    productDescription: initialValues?.product_description ?? '',
    replyVoice:
      initialValues?.reply_voice && REPLY_VOICE_VALUES.includes(initialValues.reply_voice)
        ? initialValues.reply_voice
        : null,
    productUrl: initialValues?.product_url ?? '',
    productionUrl: initialValues?.production_url ?? '',
    targetAudience: initialValues?.target_audience ?? '',
    valueProps: initialValues?.value_props ?? [],
    callToActions: initialValues?.call_to_actions ?? [],
    contentVoice:
      initialValues?.content_voice && CONTENT_VOICE_VALUES.includes(initialValues.content_voice)
        ? initialValues.content_voice
        : null,
    contentLanguage:
      initialValues?.content_language &&
      CONTENT_LANGUAGE_VALUES.includes(initialValues.content_language)
        ? initialValues.content_language
        : null,
    submitting: false,
    error: null,
  };
}

/** Typed field setter shared by the form sections. */
type Setter = <K extends keyof FormState>(field: K, value: FormState[K]) => void;

interface SubmitFlushers {
  subreddit: SubredditPickerHandle | null;
  hn: ChipInputHandle | null;
  intent: ChipInputHandle | null;
  intentExclude: ChipInputHandle | null;
  intentRequire: ChipInputHandle | null;
  valueProp: ChipInputHandle | null;
  cta: ChipInputHandle | null;
}

interface SubmitContext {
  state: FormState;
  isEdit: boolean;
  set: Setter;
  flushers: SubmitFlushers;
  onCreated?: (product: ProductRecord) => void;
  onUpdated?: (product: ProductRecord) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Validate the form, flush any pending chip input, build the request payload and
 * persist it. Extracted from the component so the render stays small; reports
 * problems through `set('error', …)` and closes the dialog on success. Preserves
 * the exact validation order, omit-when-blank edit semantics and payload shape.
 */
async function submitProduct({
  state,
  isEdit,
  set,
  flushers,
  onCreated,
  onUpdated,
  onOpenChange,
}: SubmitContext): Promise<void> {
  set('error', null);

  const trimmedId = state.id.trim();
  const trimmedName = state.name.trim();
  if (!trimmedId) {
    set('error', 'Identifiant requis.');
    return;
  }
  if (!/^[a-z0-9-]+$/.test(trimmedId)) {
    set('error', 'Identifiant invalide : minuscules, chiffres et tirets uniquement.');
    return;
  }
  if (!trimmedName) {
    set('error', 'Nom requis.');
    return;
  }

  // At least one source must be enabled
  if (!state.xEnabled && !state.redditEnabled && !state.hnEnabled) {
    set('error', 'Active au moins une source.');
    return;
  }

  // Flush pending subreddit input
  let pendingSubs = state.subreddits;
  if (state.redditEnabled) {
    const flushed = flushers.subreddit?.flush();
    if (flushed === null || flushed === undefined) {
      set('error', 'Corrige les subreddits invalides avant de continuer.');
      return;
    }
    pendingSubs = flushed;
  }

  if (state.redditEnabled && pendingSubs.length === 0) {
    set('error', 'Renseigne au moins un subreddit lorsque Reddit est activé.');
    return;
  }

  // Flush pending HN keyword input
  let pendingHnKeywords = state.hnKeywords;
  if (state.hnEnabled) {
    const flushed = flushers.hn?.flush();
    if (flushed === null || flushed === undefined) {
      set('error', 'Corrige les mots-clés Hacker News invalides avant de continuer.');
      return;
    }
    pendingHnKeywords = flushed;
  }

  if (state.hnEnabled && pendingHnKeywords.length === 0) {
    set('error', 'Renseigne au moins un mot-clé lorsque Hacker News est activé.');
    return;
  }

  if (state.hnEnabled && pendingHnKeywords.length > HN_KEYWORDS_MAX) {
    set('error', `Maximum ${HN_KEYWORDS_MAX} mots-clés Hacker News par produit.`);
    return;
  }

  // Flush pending intent keyword input
  let pendingIntentKeywords = state.intentKeywords;
  if (state.intentEnabled) {
    const flushed = flushers.intent?.flush();
    if (flushed === null || flushed === undefined) {
      set('error', "Corrige les mots-cles d'intention invalides avant de continuer.");
      return;
    }
    pendingIntentKeywords = flushed;
  }

  if (state.intentEnabled && pendingIntentKeywords.length === 0) {
    set('error', "Ajoute au moins un mot-cle d'intention.");
    return;
  }

  if (state.intentEnabled && pendingIntentKeywords.length > INTENT_KEYWORDS_MAX) {
    set('error', `Maximum ${INTENT_KEYWORDS_MAX} mots-cles d'intention par produit.`);
    return;
  }

  // Flush pending exclude / require refinement inputs (optional fields).
  let pendingIntentExclude = state.intentExcludeKeywords;
  let pendingIntentRequire = state.intentRequireKeywords;
  if (state.intentEnabled) {
    const flushedExclude = flushers.intentExclude?.flush();
    if (flushedExclude === null || flushedExclude === undefined) {
      set('error', "Corrige les mots-cles d'exclusion invalides avant de continuer.");
      return;
    }
    pendingIntentExclude = flushedExclude;

    const flushedRequire = flushers.intentRequire?.flush();
    if (flushedRequire === null || flushedRequire === undefined) {
      set('error', 'Corrige les mots-cles requis invalides avant de continuer.');
      return;
    }
    pendingIntentRequire = flushedRequire;
  }

  if (state.intentEnabled && pendingIntentExclude.length > INTENT_KEYWORDS_MAX) {
    set('error', `Maximum ${INTENT_KEYWORDS_MAX} mots-cles d'exclusion par produit.`);
    return;
  }

  if (state.intentEnabled && pendingIntentRequire.length > INTENT_KEYWORDS_MAX) {
    set('error', `Maximum ${INTENT_KEYWORDS_MAX} mots-cles requis par produit.`);
    return;
  }

  if (state.productDescription.length > PRODUCT_DESCRIPTION_MAX) {
    set('error', `Description trop longue (max ${PRODUCT_DESCRIPTION_MAX} caractères).`);
    return;
  }

  const trimmedProductUrl = state.productUrl.trim();
  if (trimmedProductUrl && !/^https?:\/\//i.test(trimmedProductUrl)) {
    set('error', "L'URL du produit doit commencer par http:// ou https://.");
    return;
  }

  const trimmedProductionUrl = state.productionUrl.trim();
  if (trimmedProductionUrl && !/^https?:\/\//i.test(trimmedProductionUrl)) {
    set('error', "L'URL de production doit commencer par http:// ou https://.");
    return;
  }

  if (state.targetAudience.length > TARGET_AUDIENCE_MAX) {
    set('error', `Audience cible trop longue (max ${TARGET_AUDIENCE_MAX} caractères).`);
    return;
  }

  // Flush pending value-prop input
  const pendingValueProps = flushers.valueProp?.flush();
  if (pendingValueProps === null || pendingValueProps === undefined) {
    set('error', 'Corrige les propositions de valeur invalides avant de continuer.');
    return;
  }
  if (pendingValueProps.length > VALUE_PROPS_MAX) {
    set('error', `Maximum ${VALUE_PROPS_MAX} propositions de valeur.`);
    return;
  }

  // Flush pending CTA input
  const pendingCtas = flushers.cta?.flush();
  if (pendingCtas === null || pendingCtas === undefined) {
    set('error', 'Corrige les CTA invalides avant de continuer.');
    return;
  }
  if (pendingCtas.length > CTAS_MAX) {
    set('error', `Maximum ${CTAS_MAX} calls to action.`);
    return;
  }

  set('submitting', true);
  try {
    const body: Record<string, unknown> = {
      name: trimmedName,
      x_enabled: state.xEnabled,
      reddit_enabled: state.redditEnabled,
      hn_enabled: state.hnEnabled,
      intent_enabled: state.intentEnabled,
    };
    if (!isEdit) {
      body.id = trimmedId;
    }

    // In edit mode, blank inputs mean "keep existing" for text-like fields
    // whose UX advertises this behavior (or where intent is ambiguous —
    // default to omit-when-blank to avoid wiping stored values).
    // The X query is only persisted when the X source is enabled; disabling X
    // is an explicit user action that nulls the column.
    if (state.xEnabled) {
      const trimmedXQuery = state.xQuery.trim();
      if (trimmedXQuery) {
        body.x_query = trimmedXQuery;
      } else if (!isEdit) {
        body.x_query = null;
      }
      // edit mode + blank: omit to preserve existing value
    } else {
      body.x_query = null;
    }

    // Subreddits are tied to the Reddit toggle: required when enabled
    // (validated above), explicitly cleared when disabled.
    body.reddit_subreddits = state.redditEnabled && pendingSubs.length > 0 ? pendingSubs : null;

    // HN keywords mirror the Reddit subreddit rule: when HN is enabled, send
    // the current array (never null — validated above); when disabled,
    // explicitly clear with null.
    body.hn_keywords = state.hnEnabled ? pendingHnKeywords : null;

    // Intent keywords: when enabled, send the current array (validated above);
    // when disabled, explicitly clear with null.
    body.intent_keywords = state.intentEnabled ? pendingIntentKeywords : null;

    // Boolean refinement lists travel with the intent toggle. Empty arrays are
    // sent as null so the backend stores "no filter" rather than "[]".
    body.intent_exclude_keywords =
      state.intentEnabled && pendingIntentExclude.length > 0 ? pendingIntentExclude : null;
    body.intent_require_keywords =
      state.intentEnabled && pendingIntentRequire.length > 0 ? pendingIntentRequire : null;

    const trimmedWebhook = state.discordWebhook.trim();
    if (trimmedWebhook) {
      body.discord_webhook = trimmedWebhook;
    } else if (!isEdit) {
      body.discord_webhook = null;
    }
    // edit mode + blank: omit to preserve the stored webhook (the placeholder
    // explicitly says "laisser vide pour conserver"). There is no
    // explicit "clear webhook" action today.

    const trimmedPrompt = state.aiPromptOverride.trim();
    if (trimmedPrompt) {
      body.ai_prompt_override = trimmedPrompt;
    } else if (!isEdit) {
      body.ai_prompt_override = null;
    }
    // edit mode + blank: omit to preserve existing prompt override

    const trimmedDescription = state.productDescription.trim();
    if (trimmedDescription) {
      body.product_description = trimmedDescription;
    } else if (!isEdit) {
      body.product_description = null;
    }
    // edit mode + blank: omit to preserve existing description

    if (state.replyVoice !== null) {
      body.reply_voice = state.replyVoice;
    } else if (!isEdit) {
      body.reply_voice = null;
    }
    // edit mode + null: omit to preserve existing voice

    // Studio fields — same omit-when-blank semantics in edit mode.
    if (trimmedProductUrl) {
      body.product_url = trimmedProductUrl;
    } else if (!isEdit) {
      body.product_url = null;
    }

    if (trimmedProductionUrl) {
      body.production_url = trimmedProductionUrl;
    } else if (!isEdit) {
      body.production_url = null;
    }

    const trimmedAudience = state.targetAudience.trim();
    if (trimmedAudience) {
      body.target_audience = trimmedAudience;
    } else if (!isEdit) {
      body.target_audience = null;
    }

    // Chip arrays: in edit mode, omit when empty to preserve existing
    // (consistent with HN/intent which keep arrays tied to a toggle, but
    // here we don't have a toggle, so the chip count is the source of truth).
    if (pendingValueProps.length > 0 || !isEdit) {
      body.value_props = pendingValueProps;
    }
    if (pendingCtas.length > 0 || !isEdit) {
      body.call_to_actions = pendingCtas;
    }

    if (state.contentVoice !== null) {
      body.content_voice = state.contentVoice;
    } else if (!isEdit) {
      body.content_voice = null;
    }

    if (state.contentLanguage !== null) {
      body.content_language = state.contentLanguage;
    } else if (!isEdit) {
      body.content_language = null;
    }

    const url = isEdit ? `/api/products/${encodeURIComponent(trimmedId)}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      set('error', data.message || `Erreur HTTP ${res.status}`);
      return;
    }
    // Backend may return the product directly or under `product`
    const product: ProductRecord = data.product || data;
    if (isEdit) {
      toast.success(`Produit « ${product.name || trimmedName} » mis à jour.`);
      onUpdated?.(product);
    } else {
      toast.success(`Produit « ${product.name || trimmedName} » créé.`);
      onCreated?.(product);
    }
    onOpenChange(false);
  } catch {
    set(
      'error',
      isEdit ? 'Erreur réseau lors de la mise à jour.' : 'Erreur réseau lors de la création.',
    );
  } finally {
    set('submitting', false);
  }
}

interface SourcesSectionProps {
  state: FormState;
  set: Setter;
  subredditRef: Ref<SubredditPickerHandle>;
  hnRef: Ref<ChipInputHandle>;
}

/** "Sources" card: X (Twitter), Reddit (subreddit picker) and Hacker News. */
function SourcesSection({ state, set, subredditRef, hnRef }: SourcesSectionProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Sources</h3>
        <p className="text-xs text-muted-foreground">Active au moins une source pour ce produit.</p>
      </div>

      {/* X (Twitter) row */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="source-x-enabled" className="flex flex-col gap-0.5">
            <span>X (Twitter)</span>
            <span className="text-xs font-normal text-muted-foreground">
              Scraping de la timeline X.
            </span>
          </Label>
          <Switch
            id="source-x-enabled"
            checked={state.xEnabled}
            onCheckedChange={(v) => set('xEnabled', v)}
            aria-label="Activer la source X"
          />
        </div>
        <div className={cn(!state.xEnabled && 'opacity-50 pointer-events-none')}>
          <Label htmlFor="product-x-query" className="text-xs">
            Requête X (optionnel)
          </Label>
          <Input
            id="product-x-query"
            value={state.xQuery}
            onChange={(e) => set('xQuery', e.target.value)}
            placeholder="from:OpenAI OR from:AnthropicAI"
            disabled={!state.xEnabled}
            className="mt-1"
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Reddit row */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="source-reddit-enabled" className="flex flex-col gap-0.5">
            <span>Reddit</span>
            <span className="text-xs font-normal text-muted-foreground">
              Surveille un ou plusieurs subreddits.
            </span>
          </Label>
          <Switch
            id="source-reddit-enabled"
            checked={state.redditEnabled}
            onCheckedChange={(v) => set('redditEnabled', v)}
            aria-label="Activer la source Reddit"
          />
        </div>
        <Label htmlFor="product-subreddits" className="text-xs">
          Subreddits
        </Label>
        <div className={cn('mt-1', !state.redditEnabled && 'opacity-50 pointer-events-none')}>
          <SubredditPicker
            ref={subredditRef}
            value={state.subreddits}
            onChange={(next) => set('subreddits', next)}
            disabled={!state.redditEnabled}
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Hacker News row */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="source-hn-enabled" className="flex flex-col gap-0.5">
            <span>Hacker News</span>
            <span className="text-xs font-normal text-muted-foreground">
              Recherche par mots-clés via Algolia.
            </span>
          </Label>
          <Switch
            id="source-hn-enabled"
            checked={state.hnEnabled}
            onCheckedChange={(v) => set('hnEnabled', v)}
            aria-label="Activer la source Hacker News"
          />
        </div>
        <Label htmlFor="product-hn-keywords" className="text-xs">
          Mots-clés
        </Label>
        <div className={cn(!state.hnEnabled && 'opacity-50 pointer-events-none')}>
          <div className="mt-1">
            <ChipInput
              ref={hnRef}
              id="product-hn-keywords"
              ariaLabel="Ajouter un mot-clé Hacker News"
              value={state.hnKeywords}
              onChange={(next) => set('hnKeywords', next)}
              parse={parseHnKeywords}
              max={HN_KEYWORDS_MAX}
              maxError={`Maximum ${HN_KEYWORDS_MAX} mots-clés par produit.`}
              removeLabel={(kw) => `Retirer ${kw}`}
              placeholder="agents IA, LLM, retrieval, ..."
              disabled={!state.hnEnabled}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tape un mot-clé puis Entrée ou virgule (2 à {HN_KEYWORD_MAX} caractères,{' '}
            {HN_KEYWORDS_MAX} max).
          </p>
        </div>
      </div>
    </div>
  );
}

interface IntentSectionProps {
  state: FormState;
  set: Setter;
  intentRef: Ref<ChipInputHandle>;
  intentExcludeRef: Ref<ChipInputHandle>;
  intentRequireRef: Ref<ChipInputHandle>;
}

/** "Détection d'intention" card: intent toggle + keywords + AI analysis context. */
function IntentSection({
  state,
  set,
  intentRef,
  intentExcludeRef,
  intentRequireRef,
}: IntentSectionProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Détection d'intention</h3>
        <p className="text-xs text-muted-foreground">
          Repère automatiquement les messages exprimant un besoin lié à ton produit.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="intent-enabled" className="flex flex-col gap-0.5">
            <span>Intent matching</span>
            <span className="text-xs font-normal text-muted-foreground">
              Génère des opportunités à partir des sources activées.
            </span>
          </Label>
          <Switch
            id="intent-enabled"
            checked={state.intentEnabled}
            onCheckedChange={(v) => set('intentEnabled', v)}
            aria-label="Activer la détection d'intention"
          />
        </div>
        <div className={cn(!state.intentEnabled && 'opacity-50 pointer-events-none')}>
          <Label htmlFor="product-intent-keywords" className="text-xs">
            Mots-clés d'intention
          </Label>
          <div className="mt-1">
            <ChipInput
              ref={intentRef}
              id="product-intent-keywords"
              ariaLabel="Ajouter un mot-clé d'intention"
              value={state.intentKeywords}
              onChange={(next) => set('intentKeywords', next)}
              parse={parseIntentKeywords}
              max={INTENT_KEYWORDS_MAX}
              maxError={`Maximum ${INTENT_KEYWORDS_MAX} mots-clés d'intention.`}
              removeLabel={(kw) => `Retirer ${kw}`}
              placeholder="alternative à figma, je cherche un outil pour, quelqu'un utilise"
              disabled={!state.intentEnabled}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tape une expression puis Entrée ou virgule ({INTENT_KEYWORD_MIN} à {INTENT_KEYWORD_MAX}{' '}
            caractères, {INTENT_KEYWORDS_MAX} max).
          </p>
        </div>

        <div className={cn('grid gap-4 sm:grid-cols-2', !state.intentEnabled && 'opacity-50 pointer-events-none')}>
          <div>
            <Label htmlFor="product-intent-exclude" className="text-xs">
              Exclure si contient (optionnel)
            </Label>
            <div className="mt-1">
              <ChipInput
                ref={intentExcludeRef}
                id="product-intent-exclude"
                ariaLabel="Ajouter un mot-clé d'exclusion"
                value={state.intentExcludeKeywords}
                onChange={(next) => set('intentExcludeKeywords', next)}
                parse={parseIntentKeywords}
                max={INTENT_KEYWORDS_MAX}
                maxError={`Maximum ${INTENT_KEYWORDS_MAX} mots-clés d'exclusion.`}
                removeLabel={(kw) => `Retirer ${kw}`}
                placeholder="emploi, recrute, salaire"
                disabled={!state.intentEnabled}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Le post est ignoré s'il contient l'un de ces termes.
            </p>
          </div>

          <div>
            <Label htmlFor="product-intent-require" className="text-xs">
              Exiger au moins un (optionnel)
            </Label>
            <div className="mt-1">
              <ChipInput
                ref={intentRequireRef}
                id="product-intent-require"
                ariaLabel="Ajouter un mot-clé requis"
                value={state.intentRequireKeywords}
                onChange={(next) => set('intentRequireKeywords', next)}
                parse={parseIntentKeywords}
                max={INTENT_KEYWORDS_MAX}
                maxError={`Maximum ${INTENT_KEYWORDS_MAX} mots-clés requis.`}
                removeLabel={(kw) => `Retirer ${kw}`}
                placeholder="cherche, recommande, quelqu'un"
                disabled={!state.intentEnabled}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Si renseigné, le post doit contenir au moins un de ces termes.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* AI analysis context — applies to lead analysis, independent of matching toggle */}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="product-description">Description du produit (pour l'IA)</Label>
          <Textarea
            id="product-description"
            value={state.productDescription}
            onChange={(e) => set('productDescription', e.target.value)}
            placeholder="Ex: un SaaS de planification Discord pour communautés gaming. Plan gratuit jusqu'à 100 membres."
            rows={4}
            maxLength={PRODUCT_DESCRIPTION_MAX}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Utilisée pour analyser la pertinence des leads et rédiger des réponses contextuelles.
            </p>
            <span
              className={cn(
                'text-xs tabular-nums',
                state.productDescription.length > PRODUCT_DESCRIPTION_MAX
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {state.productDescription.length}/{PRODUCT_DESCRIPTION_MAX}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="product-reply-voice">Ton des réponses</Label>
          <Select
            value={state.replyVoice ?? REPLY_VOICE_NONE}
            onValueChange={(value) =>
              set('replyVoice', value === REPLY_VOICE_NONE ? null : (value as ReplyVoice))
            }
          >
            <SelectTrigger id="product-reply-voice">
              <SelectValue placeholder={REPLY_VOICE_DEFAULT_LABEL} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={REPLY_VOICE_NONE}>{REPLY_VOICE_DEFAULT_LABEL}</SelectItem>
              {REPLY_VOICE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Ton utilisé pour les brouillons de réponse générés par l'IA.
          </p>
        </div>
      </div>
    </div>
  );
}

interface StudioSectionProps {
  state: FormState;
  set: Setter;
  valuePropRef: Ref<ChipInputHandle>;
  ctaRef: Ref<ChipInputHandle>;
}

/** "Studio de contenu" card: URL, audience, value props, CTAs, voice & language. */
function StudioSection({ state, set, valuePropRef, ctaRef }: StudioSectionProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Studio de contenu</h3>
        <p className="text-xs text-muted-foreground">
          Configuration utilisée pour générer des drafts de posts marketing.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-url">URL du dépôt / source</Label>
        <Input
          id="product-url"
          type="url"
          value={state.productUrl}
          onChange={(e) => set('productUrl', e.target.value)}
          placeholder="https://github.com/org/repo"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Sert à enrichir les suggestions de l'IA (ex. dépôt GitHub). N'est pas inséré dans les
          posts.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="production-url">URL de production</Label>
        <Input
          id="production-url"
          type="url"
          value={state.productionUrl}
          onChange={(e) => set('productionUrl', e.target.value)}
          placeholder="https://exemple.com"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Lien public inséré dans les posts générés. À défaut, l'URL du dépôt est utilisée.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-target-audience">Audience cible</Label>
        <Textarea
          id="product-target-audience"
          value={state.targetAudience}
          onChange={(e) => set('targetAudience', e.target.value)}
          placeholder="Ex: makers SaaS B2B francophones, PMs scale-up."
          rows={3}
          maxLength={TARGET_AUDIENCE_MAX}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Décris brièvement à qui s'adresse le produit.
          </p>
          <span
            className={cn(
              'text-xs tabular-nums',
              state.targetAudience.length > TARGET_AUDIENCE_MAX
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {state.targetAudience.length}/{TARGET_AUDIENCE_MAX}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-value-props">Propositions de valeur</Label>
        <ChipInput
          ref={valuePropRef}
          id="product-value-props"
          ariaLabel="Ajouter une proposition de valeur"
          value={state.valueProps}
          onChange={(next) => set('valueProps', next)}
          parse={parseValueProps}
          max={VALUE_PROPS_MAX}
          maxError={`Maximum ${VALUE_PROPS_MAX} propositions de valeur.`}
          removeLabel={(vp) => `Retirer ${vp}`}
          placeholder="Ex: scrape sans API officielle, résumé IA français"
        />
        <p className="text-xs text-muted-foreground">
          Tape une proposition puis Entrée ou virgule ({VALUE_PROP_MIN} à {VALUE_PROP_MAX}{' '}
          caractères, {VALUE_PROPS_MAX} max).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-ctas">Calls to action</Label>
        <ChipInput
          ref={ctaRef}
          id="product-ctas"
          ariaLabel="Ajouter un call to action"
          value={state.callToActions}
          onChange={(next) => set('callToActions', next)}
          parse={parseCtas}
          max={CTAS_MAX}
          maxError={`Maximum ${CTAS_MAX} calls to action.`}
          removeLabel={(cta) => `Retirer ${cta}`}
          placeholder="Ex: Essaie gratuit sur ton subreddit, Demande une démo"
        />
        <p className="text-xs text-muted-foreground">
          Tape un CTA puis Entrée ou virgule ({CTA_MIN} à {CTA_MAX} caractères, {CTAS_MAX} max).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-content-voice">Voix éditoriale pour les posts</Label>
        <Select
          value={state.contentVoice ?? CONTENT_VOICE_NONE}
          onValueChange={(value) =>
            set('contentVoice', value === CONTENT_VOICE_NONE ? null : (value as ContentVoice))
          }
        >
          <SelectTrigger id="product-content-voice">
            <SelectValue placeholder={CONTENT_VOICE_DEFAULT_LABEL} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CONTENT_VOICE_NONE}>{CONTENT_VOICE_DEFAULT_LABEL}</SelectItem>
            {CONTENT_VOICE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Différente de la voix des réponses si tu veux.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-content-language">Langue des posts</Label>
        <Select
          value={state.contentLanguage ?? 'fr'}
          onValueChange={(value) => set('contentLanguage', value as ContentLanguage)}
        >
          <SelectTrigger id="product-content-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_LANGUAGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Français par défaut.</p>
      </div>
    </div>
  );
}

interface ProductFormProps {
  isEdit: boolean;
  initialValues: ProductRecord | null;
  onCreated?: (product: ProductRecord) => void;
  onUpdated?: (product: ProductRecord) => void;
  onOpenChange: (open: boolean) => void;
}

function ProductForm({
  isEdit,
  initialValues,
  onCreated,
  onUpdated,
  onOpenChange,
}: ProductFormProps) {
  // Form state is seeded once from initialValues. The parent remounts this
  // component via a `key` whenever the dialog opens or the edited product
  // changes, so there is no need to mirror props into state with an effect.
  const [state, dispatch] = useReducer(formReducer, null, () =>
    buildInitialFormState(initialValues),
  );
  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    dispatch({ type: 'set', field, value } as FormAction);

  // idTouched is only consulted inside handlers (never during render), so a ref
  // avoids a needless re-render when the user first edits the id field.
  const idTouchedRef = useRef(Boolean(initialValues));
  // Imperative flush handles let handleSubmit force-commit pending chip input.
  const subredditRef = useRef<SubredditPickerHandle>(null);
  const hnRef = useRef<ChipInputHandle>(null);
  const intentRef = useRef<ChipInputHandle>(null);
  const intentExcludeRef = useRef<ChipInputHandle>(null);
  const intentRequireRef = useRef<ChipInputHandle>(null);
  const valuePropRef = useRef<ChipInputHandle>(null);
  const ctaRef = useRef<ChipInputHandle>(null);

  const { generating, generateAll } = useGenerateAll(state, set);

  const handleNameBlur = () => {
    if (!isEdit && !idTouchedRef.current && state.name.trim() && !state.id) {
      set('id', slugify(state.name));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitProduct({
      state,
      isEdit,
      set,
      flushers: {
        subreddit: subredditRef.current,
        hn: hnRef.current,
        intent: intentRef.current,
        intentExclude: intentExcludeRef.current,
        intentRequire: intentRequireRef.current,
        valueProp: valuePropRef.current,
        cta: ctaRef.current,
      },
      onCreated,
      onUpdated,
      onOpenChange,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-0">
      <div className="max-h-[72vh] overflow-y-auto space-y-4 pr-1">
      <GenerateAllButton generating={generating} onClick={() => void generateAll()} />

      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 lg:grid-cols-3 md:items-start">
      {/* Column 1 — identité et configuration */}
      <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="product-name">Nom</Label>
        <Input
          id="product-name"
          value={state.name}
          onChange={(e) => set('name', e.target.value)}
          onBlur={handleNameBlur}
          placeholder="Veille IA"
          required
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="product-id">Identifiant</Label>
        <Input
          id="product-id"
          value={state.id}
          onChange={(e) => {
            set('id', e.target.value);
            idTouchedRef.current = true;
          }}
          placeholder="veille-ia"
          required
          className="font-mono"
          disabled={isEdit}
        />
        <p className="text-xs text-muted-foreground">
          {isEdit
            ? "L'identifiant ne peut pas être modifié."
            : 'Slug unique (minuscules, chiffres et tirets). Auto-rempli depuis le nom.'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-discord-webhook">Webhook Discord (optionnel)</Label>
        <Input
          id="product-discord-webhook"
          type="password"
          value={state.discordWebhook}
          onChange={(e) => set('discordWebhook', e.target.value)}
          placeholder={
            isEdit && initialValues?.discord_webhook
              ? `Actuel : ${initialValues.discord_webhook} (laisser vide pour conserver)`
              : 'https://discord.com/api/webhooks/...'
          }
          autoComplete="off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-prompt">Prompt IA personnalisé (optionnel)</Label>
        <Textarea
          id="product-prompt"
          value={state.aiPromptOverride}
          onChange={(e) => set('aiPromptOverride', e.target.value)}
          placeholder="Surcharge facultative du prompt par défaut."
          rows={4}
        />
      </div>

      </div>

      {/* Column 2 — studio de contenu */}
      <div className="space-y-4">
      <StudioSection state={state} set={set} valuePropRef={valuePropRef} ctaRef={ctaRef} />
      </div>

      {/* Column 3 — sources de collecte et détection d'intention */}
      <div className="space-y-4">
      <SourcesSection state={state} set={set} subredditRef={subredditRef} hnRef={hnRef} />

      <IntentSection
        state={state}
        set={set}
        intentRef={intentRef}
        intentExcludeRef={intentExcludeRef}
        intentRequireRef={intentRequireRef}
      />
      </div>
      </div>

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      </div>

      <DialogFooter className="pt-4 mt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={state.submitting}
        >
          Annuler
        </Button>
        <Button type="submit" disabled={state.submitting || generating}>
          {state.submitting
            ? isEdit
              ? 'Mise à jour...'
              : 'Création...'
            : isEdit
              ? 'Enregistrer'
              : 'Créer le produit'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProductCreateDialog({
  open,
  onOpenChange,
  onCreated,
  onUpdated,
  mode = 'create',
  initialValues = null,
}: ProductCreateDialogProps) {
  const isEdit = mode === 'edit';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Éditer le produit' : 'Nouveau produit'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Modifiez les paramètres et les sources de ce produit.'
              : 'Créez un produit pour isoler ses sources, son webhook Discord et son prompt IA.'}
          </DialogDescription>
        </DialogHeader>
        {/* Remounting the form whenever the dialog opens or the edited product
            changes resets all field state without a prop-sync effect. */}
        {open && (
          <ProductForm
            key={isEdit ? (initialValues?.id ?? 'edit') : 'create'}
            isEdit={isEdit}
            initialValues={initialValues}
            onCreated={onCreated}
            onUpdated={onUpdated}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
