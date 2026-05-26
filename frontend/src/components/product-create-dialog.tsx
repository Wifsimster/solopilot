import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { Loader2, Search, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ContentLanguage,
  ContentVoice,
  ProductRecord,
  ReplyVoice,
  SubredditSearchResult,
} from '@/types';

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
const CONTENT_LANGUAGE_VALUES: ContentLanguage[] = CONTENT_LANGUAGE_OPTIONS.map(
  (o) => o.value,
);

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

function formatSubscribers(count: number): string {
  if (!count || count < 0) return '0 membre';
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M membres`;
  }
  if (count >= 1_000) {
    const k = count / 1_000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k membres`;
  }
  return `${count} membre${count > 1 ? 's' : ''}`;
}

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
  const [subredditResults, setSubredditResults] = useState<SubredditSearchResult[]>([]);
  const [subredditSearchLoading, setSubredditSearchLoading] = useState(false);
  const [subredditSearchOpen, setSubredditSearchOpen] = useState(false);
  const [subredditActiveIndex, setSubredditActiveIndex] = useState(-1);
  const subredditSearchAbortRef = useRef<AbortController | null>(null);
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
  const [productDescription, setProductDescription] = useState('');
  const [replyVoice, setReplyVoice] = useState<ReplyVoice | null>(null);
  const [productUrl, setProductUrl] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [valueProps, setValueProps] = useState<string[]>([]);
  const [valuePropInput, setValuePropInput] = useState('');
  const [valuePropError, setValuePropError] = useState<string | null>(null);
  const [callToActions, setCallToActions] = useState<string[]>([]);
  const [ctaInput, setCtaInput] = useState('');
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [contentVoice, setContentVoice] = useState<ContentVoice | null>(null);
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage | null>(null);
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
      setSubredditResults([]);
      setSubredditSearchLoading(false);
      setSubredditSearchOpen(false);
      setSubredditActiveIndex(-1);
      subredditSearchAbortRef.current?.abort();
      subredditSearchAbortRef.current = null;
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
      setProductDescription('');
      setReplyVoice(null);
      setProductUrl('');
      setTargetAudience('');
      setValueProps([]);
      setValuePropInput('');
      setValuePropError(null);
      setCallToActions([]);
      setCtaInput('');
      setCtaError(null);
      setContentVoice(null);
      setContentLanguage(null);
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
      setSubredditResults([]);
      setSubredditSearchLoading(false);
      setSubredditSearchOpen(false);
      setSubredditActiveIndex(-1);
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
      setProductDescription(initialValues.product_description ?? '');
      setReplyVoice(
        initialValues.reply_voice &&
          REPLY_VOICE_VALUES.includes(initialValues.reply_voice)
          ? initialValues.reply_voice
          : null,
      );
      setProductUrl(initialValues.product_url ?? '');
      setTargetAudience(initialValues.target_audience ?? '');
      setValueProps(initialValues.value_props ?? []);
      setValuePropInput('');
      setValuePropError(null);
      setCallToActions(initialValues.call_to_actions ?? []);
      setCtaInput('');
      setCtaError(null);
      setContentVoice(
        initialValues.content_voice &&
          CONTENT_VOICE_VALUES.includes(initialValues.content_voice)
          ? initialValues.content_voice
          : null,
      );
      setContentLanguage(
        initialValues.content_language &&
          CONTENT_LANGUAGE_VALUES.includes(initialValues.content_language)
          ? initialValues.content_language
          : null,
      );
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
    const visibleResults = subredditResults.filter(
      (r) => !subreddits.some((s) => s.toLowerCase() === r.name.toLowerCase()),
    );
    const dropdownOpen = subredditSearchOpen && visibleResults.length > 0;

    if (e.key === 'ArrowDown' && dropdownOpen) {
      e.preventDefault();
      setSubredditActiveIndex((prev) =>
        prev < visibleResults.length - 1 ? prev + 1 : 0,
      );
      return;
    }
    if (e.key === 'ArrowUp' && dropdownOpen) {
      e.preventDefault();
      setSubredditActiveIndex((prev) =>
        prev > 0 ? prev - 1 : visibleResults.length - 1,
      );
      return;
    }
    if (e.key === 'Escape' && subredditSearchOpen) {
      e.preventDefault();
      setSubredditSearchOpen(false);
      setSubredditActiveIndex(-1);
      return;
    }

    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (
        e.key === 'Enter' &&
        dropdownOpen &&
        subredditActiveIndex >= 0 &&
        subredditActiveIndex < visibleResults.length
      ) {
        e.preventDefault();
        addSubredditFromResult(visibleResults[subredditActiveIndex]);
        return;
      }
      if (subredditInput.trim()) {
        e.preventDefault();
        if (tryAddSubreddits(subredditInput)) {
          setSubredditInput('');
          setSubredditResults([]);
          setSubredditSearchOpen(false);
          setSubredditActiveIndex(-1);
        }
      }
    } else if (e.key === 'Backspace' && !subredditInput && subreddits.length > 0) {
      setSubreddits((prev) => prev.slice(0, -1));
    }
  };

  const handleSubredditBlur = () => {
    setSubredditSearchOpen(false);
    if (subredditInput.trim()) {
      if (tryAddSubreddits(subredditInput)) {
        setSubredditInput('');
      }
    }
  };

  const handleSubredditFocus = () => {
    if (subredditInput.trim().length >= 2) {
      setSubredditSearchOpen(true);
    }
  };

  const removeSubreddit = (sub: string) => {
    setSubreddits((prev) => prev.filter((s) => s !== sub));
    setSubredditError(null);
  };

  const addSubredditFromResult = (result: SubredditSearchResult) => {
    setSubreddits((prev) => {
      if (prev.some((s) => s.toLowerCase() === result.name.toLowerCase())) return prev;
      return [...prev, result.name];
    });
    setSubredditInput('');
    setSubredditError(null);
    setSubredditResults([]);
    setSubredditSearchOpen(false);
    setSubredditActiveIndex(-1);
  };

  useEffect(() => {
    if (!open || !redditEnabled) {
      return;
    }
    const query = subredditInput.trim().replace(/^\/?r\//i, '');
    if (query.length < 2) {
      subredditSearchAbortRef.current?.abort();
      subredditSearchAbortRef.current = null;
      setSubredditResults([]);
      setSubredditSearchLoading(false);
      setSubredditActiveIndex(-1);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      subredditSearchAbortRef.current?.abort();
      const controller = new AbortController();
      subredditSearchAbortRef.current = controller;
      setSubredditSearchLoading(true);
      fetch(
        `/api/reddit/search-subreddits?q=${encodeURIComponent(query)}&limit=8`,
        { signal: controller.signal },
      )
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ results?: SubredditSearchResult[] }>;
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setSubredditResults(data.results ?? []);
          setSubredditActiveIndex(-1);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setSubredditResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSubredditSearchLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [subredditInput, redditEnabled, open]);

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

  const tryAddValueProps = (raw: string): boolean => {
    const tokens = raw
      .split(/[,\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const tooShort = tokens.filter((t) => t.length < VALUE_PROP_MIN);
    if (tooShort.length > 0) {
      setValuePropError(
        `Proposition trop courte : ${tooShort.join(', ')} (min ${VALUE_PROP_MIN} caractères).`,
      );
      return false;
    }
    const tooLong = tokens.filter((t) => t.length > VALUE_PROP_MAX);
    if (tooLong.length > 0) {
      setValuePropError(
        `Proposition trop longue : ${tooLong.join(', ')} (max ${VALUE_PROP_MAX} caractères).`,
      );
      return false;
    }

    setValueProps((prev) => {
      const next = [...prev];
      for (const t of tokens) {
        if (next.length >= VALUE_PROPS_MAX) {
          setValuePropError(`Maximum ${VALUE_PROPS_MAX} propositions de valeur.`);
          break;
        }
        if (!next.some((k) => k.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      return next;
    });
    if (valueProps.length + tokens.length <= VALUE_PROPS_MAX) {
      setValuePropError(null);
    }
    return true;
  };

  const handleValuePropKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (valuePropInput.trim()) {
        e.preventDefault();
        if (tryAddValueProps(valuePropInput)) {
          setValuePropInput('');
        }
      }
    } else if (e.key === 'Backspace' && !valuePropInput && valueProps.length > 0) {
      setValueProps((prev) => prev.slice(0, -1));
    }
  };

  const handleValuePropBlur = () => {
    if (valuePropInput.trim()) {
      if (tryAddValueProps(valuePropInput)) {
        setValuePropInput('');
      }
    }
  };

  const removeValueProp = (vp: string) => {
    setValueProps((prev) => prev.filter((k) => k !== vp));
    setValuePropError(null);
  };

  const tryAddCtas = (raw: string): boolean => {
    const tokens = raw
      .split(/[,\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const tooShort = tokens.filter((t) => t.length < CTA_MIN);
    if (tooShort.length > 0) {
      setCtaError(`CTA trop court : ${tooShort.join(', ')} (min ${CTA_MIN} caractères).`);
      return false;
    }
    const tooLong = tokens.filter((t) => t.length > CTA_MAX);
    if (tooLong.length > 0) {
      setCtaError(`CTA trop long : ${tooLong.join(', ')} (max ${CTA_MAX} caractères).`);
      return false;
    }

    setCallToActions((prev) => {
      const next = [...prev];
      for (const t of tokens) {
        if (next.length >= CTAS_MAX) {
          setCtaError(`Maximum ${CTAS_MAX} calls to action.`);
          break;
        }
        if (!next.some((k) => k.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      return next;
    });
    if (callToActions.length + tokens.length <= CTAS_MAX) {
      setCtaError(null);
    }
    return true;
  };

  const handleCtaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (ctaInput.trim()) {
        e.preventDefault();
        if (tryAddCtas(ctaInput)) {
          setCtaInput('');
        }
      }
    } else if (e.key === 'Backspace' && !ctaInput && callToActions.length > 0) {
      setCallToActions((prev) => prev.slice(0, -1));
    }
  };

  const handleCtaBlur = () => {
    if (ctaInput.trim()) {
      if (tryAddCtas(ctaInput)) {
        setCtaInput('');
      }
    }
  };

  const removeCta = (cta: string) => {
    setCallToActions((prev) => prev.filter((k) => k !== cta));
    setCtaError(null);
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

    if (productDescription.length > PRODUCT_DESCRIPTION_MAX) {
      setError(`Description trop longue (max ${PRODUCT_DESCRIPTION_MAX} caractères).`);
      return;
    }

    const trimmedProductUrl = productUrl.trim();
    if (trimmedProductUrl && !/^https?:\/\//i.test(trimmedProductUrl)) {
      setError("L'URL du produit doit commencer par http:// ou https://.");
      return;
    }

    if (targetAudience.length > TARGET_AUDIENCE_MAX) {
      setError(`Audience cible trop longue (max ${TARGET_AUDIENCE_MAX} caractères).`);
      return;
    }

    // Flush pending value-prop input
    let pendingValueProps = valueProps;
    if (valuePropInput.trim()) {
      if (!tryAddValueProps(valuePropInput)) {
        setError('Corrige les propositions de valeur invalides avant de continuer.');
        return;
      }
      const tokens = valuePropInput
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const merged = [...pendingValueProps];
      for (const t of tokens) {
        if (merged.length >= VALUE_PROPS_MAX) break;
        if (!merged.some((k) => k.toLowerCase() === t.toLowerCase())) {
          merged.push(t);
        }
      }
      pendingValueProps = merged;
      setValuePropInput('');
    }
    if (pendingValueProps.length > VALUE_PROPS_MAX) {
      setError(`Maximum ${VALUE_PROPS_MAX} propositions de valeur.`);
      return;
    }

    // Flush pending CTA input
    let pendingCtas = callToActions;
    if (ctaInput.trim()) {
      if (!tryAddCtas(ctaInput)) {
        setError('Corrige les CTA invalides avant de continuer.');
        return;
      }
      const tokens = ctaInput
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const merged = [...pendingCtas];
      for (const t of tokens) {
        if (merged.length >= CTAS_MAX) break;
        if (!merged.some((k) => k.toLowerCase() === t.toLowerCase())) {
          merged.push(t);
        }
      }
      pendingCtas = merged;
      setCtaInput('');
    }
    if (pendingCtas.length > CTAS_MAX) {
      setError(`Maximum ${CTAS_MAX} calls to action.`);
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

      const trimmedDescription = productDescription.trim();
      if (trimmedDescription) {
        body.product_description = trimmedDescription;
      } else if (!isEdit) {
        body.product_description = null;
      }
      // edit mode + blank: omit to preserve existing description

      if (replyVoice !== null) {
        body.reply_voice = replyVoice;
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

      const trimmedAudience = targetAudience.trim();
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

      if (contentVoice !== null) {
        body.content_voice = contentVoice;
      } else if (!isEdit) {
        body.content_voice = null;
      }

      if (contentLanguage !== null) {
        body.content_language = contentLanguage;
      } else if (!isEdit) {
        body.content_language = null;
      }

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
                <div className="relative">
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
                    <div className="relative flex flex-1 items-center min-w-[160px]">
                      <Search className="pointer-events-none absolute left-0 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        id="product-subreddits"
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={subredditSearchOpen}
                        aria-controls="subreddit-search-listbox"
                        aria-activedescendant={
                          subredditActiveIndex >= 0
                            ? `subreddit-result-${subredditActiveIndex}`
                            : undefined
                        }
                        value={subredditInput}
                        onChange={(e) => {
                          setSubredditInput(e.target.value);
                          if (subredditError) setSubredditError(null);
                          setSubredditSearchOpen(e.target.value.trim().length >= 2);
                        }}
                        onKeyDown={handleSubredditKeyDown}
                        onBlur={handleSubredditBlur}
                        onFocus={handleSubredditFocus}
                        placeholder={
                          subreddits.length === 0 ? 'Recherche un subreddit…' : ''
                        }
                        disabled={!redditEnabled}
                        className="flex-1 bg-transparent pl-5 pr-5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                      />
                      {subredditSearchLoading && (
                        <Loader2 className="pointer-events-none absolute right-0 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  {subredditSearchOpen && redditEnabled && (() => {
                    const visibleResults = subredditResults.filter(
                      (r) =>
                        !subreddits.some(
                          (s) => s.toLowerCase() === r.name.toLowerCase(),
                        ),
                    );
                    const showEmpty =
                      !subredditSearchLoading &&
                      subredditInput.trim().length >= 2 &&
                      visibleResults.length === 0;
                    if (visibleResults.length === 0 && !showEmpty) return null;
                    return (
                      <ul
                        id="subreddit-search-listbox"
                        role="listbox"
                        className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-input bg-popover text-popover-foreground shadow-md"
                      >
                        {visibleResults.map((result, idx) => (
                          <li
                            key={result.name}
                            id={`subreddit-result-${idx}`}
                            role="option"
                            aria-selected={idx === subredditActiveIndex}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addSubredditFromResult(result);
                            }}
                            onMouseEnter={() => setSubredditActiveIndex(idx)}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 px-3 py-2 text-sm',
                              idx === subredditActiveIndex
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-accent hover:text-accent-foreground',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium">
                                  r/{result.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatSubscribers(result.subscribers)}
                                </span>
                                {result.over18 && (
                                  <span className="rounded bg-destructive/15 px-1 text-[10px] font-semibold uppercase text-destructive">
                                    NSFW
                                  </span>
                                )}
                              </div>
                              {(result.title || result.description) && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {result.description || result.title}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                        {showEmpty && (
                          <li className="px-3 py-2 text-xs text-muted-foreground">
                            Aucun subreddit trouvé pour «&nbsp;{subredditInput.trim()}&nbsp;».
                          </li>
                        )}
                      </ul>
                    );
                  })()}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tape pour rechercher un subreddit, ou colle plusieurs noms séparés par une virgule.
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

            <div className="border-t" />

            {/* AI analysis context — applies to lead analysis, independent of matching toggle */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="product-description">
                  Description du produit (pour l'IA)
                </Label>
                <Textarea
                  id="product-description"
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  placeholder="Ex: un SaaS de planification Discord pour communautés gaming. Plan gratuit jusqu'à 100 membres."
                  rows={4}
                  maxLength={PRODUCT_DESCRIPTION_MAX}
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Utilisée pour analyser la pertinence des leads et rédiger des
                    réponses contextuelles.
                  </p>
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      productDescription.length > PRODUCT_DESCRIPTION_MAX
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    {productDescription.length}/{PRODUCT_DESCRIPTION_MAX}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-reply-voice">Ton des réponses</Label>
                <Select
                  value={replyVoice ?? REPLY_VOICE_NONE}
                  onValueChange={(value) =>
                    setReplyVoice(
                      value === REPLY_VOICE_NONE ? null : (value as ReplyVoice),
                    )
                  }
                >
                  <SelectTrigger id="product-reply-voice">
                    <SelectValue placeholder={REPLY_VOICE_DEFAULT_LABEL} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={REPLY_VOICE_NONE}>
                      {REPLY_VOICE_DEFAULT_LABEL}
                    </SelectItem>
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

          {/* Studio section */}
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
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
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
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
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
                    targetAudience.length > TARGET_AUDIENCE_MAX
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {targetAudience.length}/{TARGET_AUDIENCE_MAX}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-value-props">Propositions de valeur</Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                {valueProps.map((vp) => (
                  <Badge key={vp} variant="secondary" className="gap-1 pl-2 pr-1">
                    {vp}
                    <button
                      type="button"
                      onClick={() => removeValueProp(vp)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      aria-label={`Retirer ${vp}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  id="product-value-props"
                  type="text"
                  value={valuePropInput}
                  onChange={(e) => {
                    setValuePropInput(e.target.value);
                    if (valuePropError) setValuePropError(null);
                  }}
                  onKeyDown={handleValuePropKeyDown}
                  onBlur={handleValuePropBlur}
                  placeholder={
                    valueProps.length === 0
                      ? 'Ex: scrape sans API officielle, résumé IA français'
                      : ''
                  }
                  title="Ex: scrape sans API officielle, résumé IA français"
                  className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tape une proposition puis Entrée ou virgule ({VALUE_PROP_MIN} à {VALUE_PROP_MAX} caractères, {VALUE_PROPS_MAX} max).
              </p>
              {valuePropError && (
                <p className="text-xs text-destructive" role="alert">
                  {valuePropError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-ctas">Calls to action</Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                {callToActions.map((cta) => (
                  <Badge key={cta} variant="secondary" className="gap-1 pl-2 pr-1">
                    {cta}
                    <button
                      type="button"
                      onClick={() => removeCta(cta)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      aria-label={`Retirer ${cta}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  id="product-ctas"
                  type="text"
                  value={ctaInput}
                  onChange={(e) => {
                    setCtaInput(e.target.value);
                    if (ctaError) setCtaError(null);
                  }}
                  onKeyDown={handleCtaKeyDown}
                  onBlur={handleCtaBlur}
                  placeholder={
                    callToActions.length === 0
                      ? 'Ex: Essaie gratuit sur ton subreddit, Demande une démo'
                      : ''
                  }
                  title="Ex: Essaie gratuit sur ton subreddit, Demande une démo"
                  className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tape un CTA puis Entrée ou virgule ({CTA_MIN} à {CTA_MAX} caractères, {CTAS_MAX} max).
              </p>
              {ctaError && (
                <p className="text-xs text-destructive" role="alert">
                  {ctaError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-content-voice">Voix éditoriale pour les posts</Label>
              <Select
                value={contentVoice ?? CONTENT_VOICE_NONE}
                onValueChange={(value) =>
                  setContentVoice(
                    value === CONTENT_VOICE_NONE ? null : (value as ContentVoice),
                  )
                }
              >
                <SelectTrigger id="product-content-voice">
                  <SelectValue placeholder={CONTENT_VOICE_DEFAULT_LABEL} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CONTENT_VOICE_NONE}>
                    {CONTENT_VOICE_DEFAULT_LABEL}
                  </SelectItem>
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
                value={contentLanguage ?? 'fr'}
                onValueChange={(value) =>
                  setContentLanguage(value as ContentLanguage)
                }
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
              <p className="text-xs text-muted-foreground">
                Français par défaut.
              </p>
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
