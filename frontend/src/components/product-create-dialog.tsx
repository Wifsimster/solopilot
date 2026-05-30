import { useReducer, useRef, type Ref } from 'react';
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
  discordWebhook: string;
  aiPromptOverride: string;
  productDescription: string;
  replyVoice: ReplyVoice | null;
  productUrl: string;
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

  if (state.productDescription.length > PRODUCT_DESCRIPTION_MAX) {
    set('error', `Description trop longue (max ${PRODUCT_DESCRIPTION_MAX} caractères).`);
    return;
  }

  const trimmedProductUrl = state.productUrl.trim();
  if (trimmedProductUrl && !/^https?:\/\//i.test(trimmedProductUrl)) {
    set('error', "L'URL du produit doit commencer par http:// ou https://.");
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
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Sources</h3>
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

      <div className="border-t" />

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
        <div className={cn(!state.redditEnabled && 'opacity-50 pointer-events-none')}>
          <Label htmlFor="product-subreddits" className="text-xs">
            Subreddits
          </Label>
          <SubredditPicker
            ref={subredditRef}
            value={state.subreddits}
            onChange={(next) => set('subreddits', next)}
            disabled={!state.redditEnabled}
          />
        </div>
      </div>

      <div className="border-t" />

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
        <div className={cn(!state.hnEnabled && 'opacity-50 pointer-events-none')}>
          <Label htmlFor="product-hn-keywords" className="text-xs">
            Mots-clés
          </Label>
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
}

/** "Détection d'intention" card: intent toggle + keywords + AI analysis context. */
function IntentSection({ state, set, intentRef }: IntentSectionProps) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Détection d'intention</h3>
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
      </div>

      <div className="border-t" />

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
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Studio de contenu</h3>
        <p className="text-xs text-muted-foreground">
          Configuration utilisée pour générer des drafts de posts marketing.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-url">URL du produit</Label>
        <Input
          id="product-url"
          type="url"
          value={state.productUrl}
          onChange={(e) => set('productUrl', e.target.value)}
          placeholder="https://exemple.com"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          URL principale (doit commencer par http:// ou https://).
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
  const valuePropRef = useRef<ChipInputHandle>(null);
  const ctaRef = useRef<ChipInputHandle>(null);

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
        valueProp: valuePropRef.current,
        cta: ctaRef.current,
      },
      onCreated,
      onUpdated,
      onOpenChange,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
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

      <SourcesSection state={state} set={set} subredditRef={subredditRef} hnRef={hnRef} />

      <IntentSection state={state} set={set} intentRef={intentRef} />

      <StudioSection state={state} set={set} valuePropRef={valuePropRef} ctaRef={ctaRef} />

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={state.submitting}
        >
          Annuler
        </Button>
        <Button type="submit" disabled={state.submitting}>
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
      <DialogContent>
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
