import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductRecord } from '@/types';

type DialogMode = 'create' | 'edit';

interface ProductCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (product: ProductRecord) => void;
  onUpdated?: (product: ProductRecord) => void;
  mode?: DialogMode;
  initialValues?: ProductRecord | null;
}

const SUBREDDIT_REGEX = /^[A-Za-z0-9_]{2,21}$/;
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

export function ProductCreateDialog({
  open,
  onOpenChange,
  onCreated,
  onUpdated,
  mode = 'create',
  initialValues = null,
}: ProductCreateDialogProps) {
  const isEdit = mode === 'edit';

  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [xEnabled, setXEnabled] = useState(true);
  const [xQuery, setXQuery] = useState('');
  const [redditEnabled, setRedditEnabled] = useState(false);
  const [subreddits, setSubreddits] = useState<string[]>([]);
  const [subredditInput, setSubredditInput] = useState('');
  const [subredditError, setSubredditError] = useState<string | null>(null);
  const [hnEnabled, setHnEnabled] = useState(false);
  const [hnKeywords, setHnKeywords] = useState<string[]>([]);
  const [hnKeywordInput, setHnKeywordInput] = useState('');
  const [hnKeywordError, setHnKeywordError] = useState<string | null>(null);
  const [intentEnabled, setIntentEnabled] = useState(false);
  const [intentKeywords, setIntentKeywords] = useState<string[]>([]);
  const [intentKeywordInput, setIntentKeywordInput] = useState('');
  const [intentKeywordError, setIntentKeywordError] = useState<string | null>(null);
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [aiPromptOverride, setAiPromptOverride] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize / reset state when dialog opens or initialValues change
  useEffect(() => {
    if (!open) {
      // Reset everything when closing
      setName('');
      setId('');
      setIdTouched(false);
      setXEnabled(true);
      setXQuery('');
      setRedditEnabled(false);
      setSubreddits([]);
      setSubredditInput('');
      setSubredditError(null);
      setHnEnabled(false);
      setHnKeywords([]);
      setHnKeywordInput('');
      setHnKeywordError(null);
      setIntentEnabled(false);
      setIntentKeywords([]);
      setIntentKeywordInput('');
      setIntentKeywordError(null);
      setDiscordWebhook('');
      setAiPromptOverride('');
      setSubmitting(false);
      setError(null);
      return;
    }
    if (initialValues) {
      setName(initialValues.name ?? '');
      setId(initialValues.id ?? '');
      setIdTouched(true);
      setXEnabled(initialValues.x_enabled ?? true);
      setXQuery(initialValues.x_query ?? '');
      setRedditEnabled(initialValues.reddit_enabled ?? false);
      setSubreddits(initialValues.reddit_subreddits ?? []);
      setSubredditInput('');
      setSubredditError(null);
      setHnEnabled(initialValues.hn_enabled ?? false);
      setHnKeywords(initialValues.hn_keywords ?? []);
      setHnKeywordInput('');
      setHnKeywordError(null);
      setIntentEnabled(initialValues.intent_enabled ?? false);
      setIntentKeywords(initialValues.intent_keywords ?? []);
      setIntentKeywordInput('');
      setIntentKeywordError(null);
      // discord_webhook is masked from backend — leave blank so user can re-enter only if changing
      setDiscordWebhook('');
      setAiPromptOverride(initialValues.ai_prompt_override ?? '');
      setError(null);
    }
  }, [open, initialValues]);

  const handleNameBlur = () => {
    if (!isEdit && !idTouched && name.trim() && !id) {
      setId(slugify(name));
    }
  };

  const tryAddSubreddits = (raw: string): boolean => {
    const tokens = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^\/?r\//i, ''))
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const invalid = tokens.filter((t) => !SUBREDDIT_REGEX.test(t));
    if (invalid.length > 0) {
      setSubredditError(
        `Subreddit invalide : ${invalid.join(', ')} (2-21 caractères, lettres, chiffres ou _).`,
      );
      return false;
    }

    setSubreddits((prev) => {
      const next = [...prev];
      for (const t of tokens) {
        if (!next.some((s) => s.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      return next;
    });
    setSubredditError(null);
    return true;
  };

  const handleSubredditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (subredditInput.trim()) {
        e.preventDefault();
        if (tryAddSubreddits(subredditInput)) {
          setSubredditInput('');
        }
      }
    } else if (e.key === 'Backspace' && !subredditInput && subreddits.length > 0) {
      setSubreddits((prev) => prev.slice(0, -1));
    }
  };

  const handleSubredditBlur = () => {
    if (subredditInput.trim()) {
      if (tryAddSubreddits(subredditInput)) {
        setSubredditInput('');
      }
    }
  };

  const removeSubreddit = (sub: string) => {
    setSubreddits((prev) => prev.filter((s) => s !== sub));
    setSubredditError(null);
  };

  const tryAddHnKeywords = (raw: string): boolean => {
    const tokens = raw
      .split(/[,\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const tooShort = tokens.filter((t) => t.length < HN_KEYWORD_MIN);
    if (tooShort.length > 0) {
      setHnKeywordError(
        `Mot-clé trop court : ${tooShort.join(', ')} (min ${HN_KEYWORD_MIN} caractères).`,
      );
      return false;
    }
    const tooLong = tokens.filter((t) => t.length > HN_KEYWORD_MAX);
    if (tooLong.length > 0) {
      setHnKeywordError(
        `Mot-clé trop long : ${tooLong.join(', ')} (max ${HN_KEYWORD_MAX} caractères).`,
      );
      return false;
    }

    setHnKeywords((prev) => {
      const next = [...prev];
      for (const t of tokens) {
        if (next.length >= HN_KEYWORDS_MAX) {
          setHnKeywordError(`Maximum ${HN_KEYWORDS_MAX} mots-clés par produit.`);
          break;
        }
        if (!next.some((k) => k.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      return next;
    });
    if (hnKeywords.length + tokens.length <= HN_KEYWORDS_MAX) {
      setHnKeywordError(null);
    }
    return true;
  };

  const handleHnKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (hnKeywordInput.trim()) {
        e.preventDefault();
        if (tryAddHnKeywords(hnKeywordInput)) {
          setHnKeywordInput('');
        }
      }
    } else if (e.key === 'Backspace' && !hnKeywordInput && hnKeywords.length > 0) {
      setHnKeywords((prev) => prev.slice(0, -1));
    }
  };

  const handleHnKeywordBlur = () => {
    if (hnKeywordInput.trim()) {
      if (tryAddHnKeywords(hnKeywordInput)) {
        setHnKeywordInput('');
      }
    }
  };

  const removeHnKeyword = (kw: string) => {
    setHnKeywords((prev) => prev.filter((k) => k !== kw));
    setHnKeywordError(null);
  };

  const tryAddIntentKeywords = (raw: string): boolean => {
    const tokens = raw
      .split(/[,\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const tooShort = tokens.filter((t) => t.length < INTENT_KEYWORD_MIN);
    if (tooShort.length > 0) {
      setIntentKeywordError(
        `Mot-clé trop court : ${tooShort.join(', ')} (min ${INTENT_KEYWORD_MIN} caractères).`,
      );
      return false;
    }
    const tooLong = tokens.filter((t) => t.length > INTENT_KEYWORD_MAX);
    if (tooLong.length > 0) {
      setIntentKeywordError(
        `Mot-clé trop long : ${tooLong.join(', ')} (max ${INTENT_KEYWORD_MAX} caractères).`,
      );
      return false;
    }

    setIntentKeywords((prev) => {
      const next = [...prev];
      for (const t of tokens) {
        if (next.length >= INTENT_KEYWORDS_MAX) {
          setIntentKeywordError(`Maximum ${INTENT_KEYWORDS_MAX} mots-clés d'intention.`);
          break;
        }
        if (!next.some((k) => k.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      return next;
    });
    if (intentKeywords.length + tokens.length <= INTENT_KEYWORDS_MAX) {
      setIntentKeywordError(null);
    }
    return true;
  };

  const handleIntentKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (intentKeywordInput.trim()) {
        e.preventDefault();
        if (tryAddIntentKeywords(intentKeywordInput)) {
          setIntentKeywordInput('');
        }
      }
    } else if (e.key === 'Backspace' && !intentKeywordInput && intentKeywords.length > 0) {
      setIntentKeywords((prev) => prev.slice(0, -1));
    }
  };

  const handleIntentKeywordBlur = () => {
    if (intentKeywordInput.trim()) {
      if (tryAddIntentKeywords(intentKeywordInput)) {
        setIntentKeywordInput('');
      }
    }
  };

  const removeIntentKeyword = (kw: string) => {
    setIntentKeywords((prev) => prev.filter((k) => k !== kw));
    setIntentKeywordError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId) {
      setError('Identifiant requis.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(trimmedId)) {
      setError('Identifiant invalide : minuscules, chiffres et tirets uniquement.');
      return;
    }
    if (!trimmedName) {
      setError('Nom requis.');
      return;
    }

    // At least one source must be enabled
    if (!xEnabled && !redditEnabled && !hnEnabled) {
      setError('Active au moins une source.');
      return;
    }

    // Flush pending subreddit input
    let pendingSubs = subreddits;
    if (redditEnabled && subredditInput.trim()) {
      if (!tryAddSubreddits(subredditInput)) {
        setError('Corrige les subreddits invalides avant de continuer.');
        return;
      }
      // Recompute the list based on the current input
      const tokens = subredditInput
        .split(/[\s,]+/)
        .map((t) => t.trim().replace(/^\/?r\//i, ''))
        .filter(Boolean);
      const merged = [...pendingSubs];
      for (const t of tokens) {
        if (!merged.some((s) => s.toLowerCase() === t.toLowerCase())) {
          merged.push(t);
        }
      }
      pendingSubs = merged;
      setSubredditInput('');
    }

    if (redditEnabled && pendingSubs.length === 0) {
      setError('Renseigne au moins un subreddit lorsque Reddit est activé.');
      return;
    }

    // Flush pending HN keyword input
    let pendingHnKeywords = hnKeywords;
    if (hnEnabled && hnKeywordInput.trim()) {
      if (!tryAddHnKeywords(hnKeywordInput)) {
        setError('Corrige les mots-clés Hacker News invalides avant de continuer.');
        return;
      }
      const tokens = hnKeywordInput
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const merged = [...pendingHnKeywords];
      for (const t of tokens) {
        if (merged.length >= HN_KEYWORDS_MAX) break;
        if (!merged.some((k) => k.toLowerCase() === t.toLowerCase())) {
          merged.push(t);
        }
      }
      pendingHnKeywords = merged;
      setHnKeywordInput('');
    }

    if (hnEnabled && pendingHnKeywords.length === 0) {
      setError('Renseigne au moins un mot-clé lorsque Hacker News est activé.');
      return;
    }

    if (hnEnabled && pendingHnKeywords.length > HN_KEYWORDS_MAX) {
      setError(`Maximum ${HN_KEYWORDS_MAX} mots-clés Hacker News par produit.`);
      return;
    }

    // Flush pending intent keyword input
    let pendingIntentKeywords = intentKeywords;
    if (intentEnabled && intentKeywordInput.trim()) {
      if (!tryAddIntentKeywords(intentKeywordInput)) {
        setError("Corrige les mots-cles d'intention invalides avant de continuer.");
        return;
      }
      const tokens = intentKeywordInput
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const merged = [...pendingIntentKeywords];
      for (const t of tokens) {
        if (merged.length >= INTENT_KEYWORDS_MAX) break;
        if (!merged.some((k) => k.toLowerCase() === t.toLowerCase())) {
          merged.push(t);
        }
      }
      pendingIntentKeywords = merged;
      setIntentKeywordInput('');
    }

    if (intentEnabled && pendingIntentKeywords.length === 0) {
      setError("Ajoute au moins un mot-cle d'intention.");
      return;
    }

    if (intentEnabled && pendingIntentKeywords.length > INTENT_KEYWORDS_MAX) {
      setError(`Maximum ${INTENT_KEYWORDS_MAX} mots-cles d'intention par produit.`);
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: trimmedName,
        x_enabled: xEnabled,
        reddit_enabled: redditEnabled,
        hn_enabled: hnEnabled,
        intent_enabled: intentEnabled,
      };
      if (!isEdit) {
        body.id = trimmedId;
      }

      // In edit mode, blank inputs mean "keep existing" for text-like fields
      // whose UX advertises this behavior (or where intent is ambiguous —
      // default to omit-when-blank to avoid wiping stored values).
      // The X query is only persisted when the X source is enabled; disabling X
      // is an explicit user action that nulls the column.
      if (xEnabled) {
        const trimmedXQuery = xQuery.trim();
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
      body.reddit_subreddits = redditEnabled && pendingSubs.length > 0 ? pendingSubs : null;

      // HN keywords mirror the Reddit subreddit rule: when HN is enabled, send
      // the current array (never null — validated above); when disabled,
      // explicitly clear with null.
      body.hn_keywords = hnEnabled ? pendingHnKeywords : null;

      // Intent keywords: when enabled, send the current array (validated above);
      // when disabled, explicitly clear with null.
      body.intent_keywords = intentEnabled ? pendingIntentKeywords : null;

      const trimmedWebhook = discordWebhook.trim();
      if (trimmedWebhook) {
        body.discord_webhook = trimmedWebhook;
      } else if (!isEdit) {
        body.discord_webhook = null;
      }
      // edit mode + blank: omit to preserve the stored webhook (the placeholder
      // explicitly says "laisser vide pour conserver"). There is no
      // explicit "clear webhook" action today.

      const trimmedPrompt = aiPromptOverride.trim();
      if (trimmedPrompt) {
        body.ai_prompt_override = trimmedPrompt;
      } else if (!isEdit) {
        body.ai_prompt_override = null;
      }
      // edit mode + blank: omit to preserve existing prompt override

      const url = isEdit
        ? `/api/products/${encodeURIComponent(trimmedId)}`
        : '/api/products';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.message || `Erreur HTTP ${res.status}`);
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
      setError(
        isEdit
          ? 'Erreur réseau lors de la mise à jour.'
          : 'Erreur réseau lors de la création.',
      );
    } finally {
      setSubmitting(false);
    }
  };

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
        <form
          onSubmit={handleSubmit}
          className="space-y-4 max-h-[70vh] overflow-y-auto pr-1"
        >
          <div className="space-y-2">
            <Label htmlFor="product-name">Nom</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdTouched(true);
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
              value={discordWebhook}
              onChange={(e) => setDiscordWebhook(e.target.value)}
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
              value={aiPromptOverride}
              onChange={(e) => setAiPromptOverride(e.target.value)}
              placeholder="Surcharge facultative du prompt par défaut."
              rows={4}
            />
          </div>

          {/* Sources section */}
          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <h3 className="text-sm font-semibold">Sources</h3>
              <p className="text-xs text-muted-foreground">
                Active au moins une source pour ce produit.
              </p>
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
                  checked={xEnabled}
                  onCheckedChange={setXEnabled}
                  aria-label="Activer la source X"
                />
              </div>
              <div className={cn(!xEnabled && 'opacity-50 pointer-events-none')}>
                <Label htmlFor="product-x-query" className="text-xs">
                  Requête X (optionnel)
                </Label>
                <Input
                  id="product-x-query"
                  value={xQuery}
                  onChange={(e) => setXQuery(e.target.value)}
                  placeholder="from:OpenAI OR from:AnthropicAI"
                  disabled={!xEnabled}
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
                  checked={redditEnabled}
                  onCheckedChange={setRedditEnabled}
                  aria-label="Activer la source Reddit"
                />
              </div>
              <div className={cn(!redditEnabled && 'opacity-50 pointer-events-none')}>
                <Label htmlFor="product-subreddits" className="text-xs">
                  Subreddits
                </Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                  {subreddits.map((sub) => (
                    <Badge
                      key={sub}
                      variant="secondary"
                      className="gap-1 pl-2 pr-1 font-mono"
                    >
                      r/{sub}
                      <button
                        type="button"
                        onClick={() => removeSubreddit(sub)}
                        disabled={!redditEnabled}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Retirer r/${sub}`}
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    id="product-subreddits"
                    type="text"
                    value={subredditInput}
                    onChange={(e) => {
                      setSubredditInput(e.target.value);
                      if (subredditError) setSubredditError(null);
                    }}
                    onKeyDown={handleSubredditKeyDown}
                    onBlur={handleSubredditBlur}
                    placeholder={subreddits.length === 0 ? 'webdev, SaaS, ...' : ''}
                    disabled={!redditEnabled}
                    className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tape le nom du subreddit (sans «&nbsp;r/&nbsp;»), puis Entrée, virgule ou espace.
                </p>
                {subredditError && (
                  <p className="mt-1 text-xs text-destructive" role="alert">
                    {subredditError}
                  </p>
                )}
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
                  checked={hnEnabled}
                  onCheckedChange={setHnEnabled}
                  aria-label="Activer la source Hacker News"
                />
              </div>
              <div className={cn(!hnEnabled && 'opacity-50 pointer-events-none')}>
                <Label htmlFor="product-hn-keywords" className="text-xs">
                  Mots-clés
                </Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                  {hnKeywords.map((kw) => (
                    <Badge
                      key={kw}
                      variant="secondary"
                      className="gap-1 pl-2 pr-1"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeHnKeyword(kw)}
                        disabled={!hnEnabled}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Retirer ${kw}`}
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    id="product-hn-keywords"
                    type="text"
                    value={hnKeywordInput}
                    onChange={(e) => {
                      setHnKeywordInput(e.target.value);
                      if (hnKeywordError) setHnKeywordError(null);
                    }}
                    onKeyDown={handleHnKeywordKeyDown}
                    onBlur={handleHnKeywordBlur}
                    placeholder={
                      hnKeywords.length === 0
                        ? 'agents IA, LLM, retrieval, ...'
                        : ''
                    }
                    disabled={!hnEnabled}
                    className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tape un mot-clé puis Entrée ou virgule (2 à {HN_KEYWORD_MAX} caractères, {HN_KEYWORDS_MAX} max).
                </p>
                {hnKeywordError && (
                  <p className="mt-1 text-xs text-destructive" role="alert">
                    {hnKeywordError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Intent matching section */}
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
                  checked={intentEnabled}
                  onCheckedChange={setIntentEnabled}
                  aria-label="Activer la détection d'intention"
                />
              </div>
              <div className={cn(!intentEnabled && 'opacity-50 pointer-events-none')}>
                <Label htmlFor="product-intent-keywords" className="text-xs">
                  Mots-clés d'intention
                </Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                  {intentKeywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="gap-1 pl-2 pr-1">
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeIntentKeyword(kw)}
                        disabled={!intentEnabled}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Retirer ${kw}`}
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    id="product-intent-keywords"
                    type="text"
                    value={intentKeywordInput}
                    onChange={(e) => {
                      setIntentKeywordInput(e.target.value);
                      if (intentKeywordError) setIntentKeywordError(null);
                    }}
                    onKeyDown={handleIntentKeywordKeyDown}
                    onBlur={handleIntentKeywordBlur}
                    placeholder={
                      intentKeywords.length === 0
                        ? 'alternative à figma, je cherche un outil pour, quelqu\'un utilise'
                        : ''
                    }
                    disabled={!intentEnabled}
                    className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tape une expression puis Entrée ou virgule ({INTENT_KEYWORD_MIN} à {INTENT_KEYWORD_MAX} caractères, {INTENT_KEYWORDS_MAX} max).
                </p>
                {intentKeywordError && (
                  <p className="mt-1 text-xs text-destructive" role="alert">
                    {intentKeywordError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? isEdit
                  ? 'Mise à jour...'
                  : 'Création...'
                : isEdit
                  ? 'Enregistrer'
                  : 'Créer le produit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
