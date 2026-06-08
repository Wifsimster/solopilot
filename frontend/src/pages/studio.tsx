import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '@/hooks/use-api';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  AlertTriangle,
  Sparkles,
  Copy,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  Wand2,
  Globe,
  Mic,
  Link2,
  ExternalLink,
  Settings2,
  Save,
  Search,
  ArrowDownUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatRelativeFr } from '@/lib/utils';
import {
  PLATFORM_LIMITS,
  SOURCE_META,
  SourceBadge,
} from '@/components/studio/platform-meta';
import type {
  ContentDraft,
  ContentDraftStatus,
  ContentLanguage,
  ContentVoice,
  ProductRecord,
  TargetSource,
} from '@/types';

type StatusFilter = ContentDraftStatus;

type SortKey = 'recent' | 'oldest' | 'longest';

type SourceFilter = TargetSource | 'all';

type TabConfig = {
  id: StatusFilter;
  label: string;
  emptyTitle: string;
  emptyHint: string;
};

const TABS: TabConfig[] = [
  {
    id: 'pending',
    label: 'En attente',
    emptyTitle: 'Aucun draft en attente.',
    emptyHint: 'Lance une génération depuis le bandeau ci-dessus.',
  },
  {
    id: 'edited',
    label: 'Éditées',
    emptyTitle: 'Aucune version éditée.',
    emptyHint: "Modifie le texte d'un draft pour le retrouver ici.",
  },
  {
    id: 'used',
    label: 'Utilisées',
    emptyTitle: 'Aucun draft utilisé pour le moment.',
    emptyHint: "Marque un draft comme utilisé après l'avoir posté.",
  },
  {
    id: 'discarded',
    label: 'Jetées',
    emptyTitle: 'Aucun draft jeté.',
    emptyHint: 'Les versions écartées apparaîtront ici.',
  },
];

const USED_ON_OPTIONS: { value: string; label: string }[] = [
  { value: 'x', label: 'X' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'autre', label: 'Autre' },
];

const COUNT_OPTIONS = [3, 5, 10];

// Quick presets sit alongside the flexible generator for one-click batches.
type GeneratePreset = {
  key: string;
  label: string;
  count: number;
  source: TargetSource;
};

const GENERATE_PRESETS: GeneratePreset[] = [
  { key: 'x', label: '10 posts X', count: 10, source: 'x' },
  { key: 'reddit', label: '10 posts Reddit', count: 10, source: 'reddit' },
  { key: 'generic', label: '5 posts génériques', count: 5, source: 'generic' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'oldest', label: 'Plus anciens' },
  { value: 'longest', label: 'Plus longs' },
];

const SOURCE_FILTER_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Toutes les sources' },
  { value: 'x', label: 'X' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'generic', label: 'Générique' },
];

const VOICE_LABELS: Record<ContentVoice, string> = {
  decontractee: 'Décontractée',
  professionnelle: 'Professionnelle',
  directe: 'Directe',
  aidante: 'Aidante',
};

function statusLabel(status: ContentDraftStatus): string {
  if (status === 'pending') return 'En attente';
  if (status === 'edited') return 'Éditée';
  if (status === 'used') return 'Utilisée';
  return 'Jetée';
}

function statusBadgeVariant(
  status: ContentDraftStatus,
): 'secondary' | 'success' | 'warning' | 'destructive' {
  if (status === 'used') return 'success';
  if (status === 'edited') return 'warning';
  if (status === 'discarded') return 'destructive';
  return 'secondary';
}

/** Pre-select the "posted on" platform from the draft's target source. */
function defaultUsedOn(source: TargetSource | null): string {
  if (source === 'reddit') return 'reddit';
  if (source === 'generic') return 'linkedin';
  return 'x';
}

/** True when a URL points at a code-hosting repo rather than a product site. */
function isCodeRepoUrl(url: string): boolean {
  return /(?:github\.com|gitlab\.com|bitbucket\.org)/i.test(url);
}

/** Strip protocol and trailing slash for compact display. */
function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** Live character count with platform-aware over-limit warning. */
function CharCount({ length, source }: { length: number; source: TargetSource | null }) {
  const limit = source ? PLATFORM_LIMITS[source] : null;
  if (limit === null) {
    return <span className="text-xs text-muted-foreground tabular-nums">{length} car.</span>;
  }
  const over = length > limit;
  const near = !over && length > limit * 0.9;
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        over ? 'text-destructive font-medium' : near ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      {length} / {limit}
      {over ? (source === 'x' ? ' · dépasse la limite X' : ' · au-dessus du format conseillé') : ''}
    </span>
  );
}

interface DraftCardProps {
  draft: ContentDraft;
  onMutated: () => void;
}

function DraftCard({ draft, onMutated }: DraftCardProps) {
  const initialText = draft.edited_text ?? draft.text;
  const [text, setText] = useState(initialText);
  const [usedOn, setUsedOn] = useState<string>(draft.used_on ?? defaultUsedOn(draft.target_source));
  const [busy, setBusy] = useState<ContentDraftStatus | 'save' | null>(null);

  // Keep textarea in sync if the server-side draft changes (e.g. after refetch)
  // while preserving in-flight user edits. The last saved value lives in a ref
  // (it is never rendered) and the sync runs during render rather than in an
  // effect to avoid an extra pass. A save also updates the ref directly.
  const lastSavedTextRef = useRef(initialText);
  const incomingText = draft.edited_text ?? draft.text;
  if (incomingText !== lastSavedTextRef.current) {
    if (text === lastSavedTextRef.current) {
      setText(incomingText);
    }
    lastSavedTextRef.current = incomingText;
  }

  const dirty = text !== lastSavedTextRef.current && text.trim().length > 0;

  const patch = useCallback(
    async (
      body: Partial<Pick<ContentDraft, 'status' | 'edited_text' | 'used_on'>>,
      tag: ContentDraftStatus | 'save',
      successMsg: string,
    ) => {
      setBusy(tag);
      try {
        const res = await fetch(`/api/content-drafts/${draft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          toast.error(json?.message || `Erreur HTTP ${res.status}`);
          return;
        }
        toast.success(successMsg);
        if (typeof body.edited_text === 'string') {
          lastSavedTextRef.current = body.edited_text;
        }
        onMutated();
      } catch {
        toast.error('Erreur réseau lors de la mise à jour.');
      } finally {
        setBusy(null);
      }
    },
    [draft.id, onMutated],
  );

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    await patch({ edited_text: text, status: 'edited' }, 'save', 'Modifications enregistrées.');
  }, [dirty, patch, text]);

  const saveDraftIfDirty = useCallback(() => {
    if (dirty) {
      void handleSave();
    }
  }, [dirty, handleSave]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copié!');
    } catch {
      toast.error('Impossible de copier le texte.');
    }
  }, [text]);

  const handleMarkUsed = useCallback(async () => {
    await patch({ status: 'used', used_on: usedOn }, 'used', 'Marquée comme utilisée.');
  }, [patch, usedOn]);

  const handleDiscard = useCallback(async () => {
    await patch({ status: 'discarded' }, 'discarded', 'Draft jeté.');
  }, [patch]);

  const handleRestore = useCallback(async () => {
    await patch({ status: 'pending' }, 'pending', 'Draft restauré.');
  }, [patch]);

  // Subtle left accent border colored by the draft's source. Uses a literal
  // class from SOURCE_META so Tailwind's compiler emits it (runtime-built
  // class names like `bg-…`→`border-l-…` are not detected).
  const accentClass = draft.target_source
    ? SOURCE_META[draft.target_source].borderClass
    : 'border-l-muted';

  return (
    <Card
      className={cn(
        'border-l-2 hover:border-muted-foreground/20 transition-colors',
        accentClass,
      )}
    >
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source={draft.target_source} />
            {draft.angle && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {draft.angle}
              </Badge>
            )}
            <Badge variant={statusBadgeVariant(draft.status)} className="text-[10px] px-1.5 py-0">
              {statusLabel(draft.status)}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            Générée {formatRelativeFr(draft.generated_at)}
          </span>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={saveDraftIfDirty}
          rows={5}
          aria-label="Texte du draft"
        />

        <div className="flex justify-end -mt-1">
          <CharCount length={text.length} source={draft.target_source} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleCopy}
              disabled={!text.trim()}
            >
              <Copy className="size-3.5 mr-1" />
              Copier
            </Button>
            {dirty && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleSave}
                disabled={busy !== null}
              >
                {busy === 'save' ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <Save className="size-3.5 mr-1" />
                )}
                Sauvegarder
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draft.status !== 'used' && (
              <>
                <Select value={usedOn} onValueChange={setUsedOn}>
                  <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Plateforme utilisée">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USED_ON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={handleMarkUsed}
                  disabled={busy !== null}
                >
                  {busy === 'used' ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5 mr-1" />
                  )}
                  Marquer utilisée
                </Button>
              </>
            )}
            {draft.status !== 'discarded' && draft.status !== 'used' && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                onClick={handleDiscard}
                disabled={busy !== null}
              >
                {busy === 'discarded' ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <XCircle className="size-3.5 mr-1" />
                )}
                Jeter
              </Button>
            )}
            {draft.status !== 'pending' && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleRestore}
                disabled={busy !== null}
              >
                {busy === 'pending' ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5 mr-1" />
                )}
                Restaurer
              </Button>
            )}
          </div>
        </div>

        {draft.status === 'used' && draft.used_on && (
          <p className="text-xs text-muted-foreground">
            Posté sur {draft.used_on}
            {draft.used_at ? ` ${formatRelativeFr(draft.used_at)}` : ''}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Wand2 className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground max-w-xs">{hint}</p>
    </div>
  );
}

function NoResultsState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Search className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">Aucun résultat pour ces filtres.</p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Réinitialiser les filtres
      </Button>
    </div>
  );
}

function DraftsList({
  drafts,
  onMutated,
}: {
  drafts: ContentDraft[];
  onMutated: () => void;
}) {
  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} onMutated={onMutated} />
      ))}
    </div>
  );
}

/** A small muted stat chip for the summary strip. */
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Compact, read-only summary of the product settings that drive generation
 * (language, voice, promo URL) plus actionable hints when settings that
 * materially affect draft quality are missing. Keeps the user from generating
 * a batch of off-target drafts before realising a key field is empty.
 */
function ProductContextStrip({ product }: { product: ProductRecord }) {
  const lang: ContentLanguage = product.content_language ?? 'fr';
  const voice = product.content_voice ?? product.reply_voice ?? 'professionnelle';
  const promoUrl = product.production_url || product.product_url || null;
  const promoIsRepoOnly = !product.production_url && !!promoUrl && isCodeRepoUrl(promoUrl);
  const missingValueProps = product.value_props.length === 0;
  const missingCtas = product.call_to_actions.length === 0;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3.5" />
          {lang === 'en' ? 'Anglais' : 'Français'}
        </span>
        <span className="inline-flex items-center gap-1">
          <Mic className="size-3.5" />
          {VOICE_LABELS[voice]}
        </span>
        {promoUrl ? (
          <a
            href={promoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 max-w-[20rem] hover:text-foreground hover:underline"
          >
            <Link2 className="size-3.5 shrink-0" />
            <span className="truncate">{prettyUrl(promoUrl)}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning">
            <Link2 className="size-3.5" />
            Aucune URL à promouvoir
          </span>
        )}
      </div>

      {!promoUrl && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Aucune URL à promouvoir n'est configurée : les drafts ne contiendront pas de lien vers
            ton produit.{' '}
            <Link to="/products" className="font-medium underline underline-offset-2">
              Ajoute une URL de production
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {promoIsRepoOnly && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            La seule URL connue pointe vers un dépôt de code ({prettyUrl(promoUrl!)}). Les drafts
            risquent de renvoyer vers GitHub.{' '}
            <Link to="/products" className="font-medium underline underline-offset-2">
              Renseigne une URL de production
            </Link>{' '}
            pour des liens orientés produit.
          </AlertDescription>
        </Alert>
      )}

      {(missingValueProps || missingCtas) && (
        <Alert>
          <Settings2 className="size-4" />
          <AlertDescription>
            {missingValueProps && missingCtas
              ? 'Ajoute des propositions de valeur et des appels à l’action'
              : missingValueProps
                ? 'Ajoute des propositions de valeur'
                : 'Ajoute des appels à l’action'}{' '}
            dans les{' '}
            <Link to="/products" className="font-medium underline underline-offset-2">
              paramètres du produit
            </Link>{' '}
            pour des drafts plus convaincants.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function StudioPage() {
  const { selectedProductId } = useSelectedProduct();
  const [activeTab, setActiveTab] = useState<StatusFilter>('pending');
  // Identifies which generate control is in flight ('custom' for the flexible
  // generator, or a preset key) so only that control shows its spinner.
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Flexible generator controls.
  const [genSource, setGenSource] = useState<TargetSource>('x');
  const [genCount, setGenCount] = useState<number>(5);

  // Toolbar (search / filter / sort) — applies to the active tab only.
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  const productReq = useApi<ProductRecord>(
    `/api/products/${encodeURIComponent(selectedProductId)}`,
  );

  const pendingReq = useApi<ContentDraft[]>('/api/content-drafts?status=pending&kind=post', {
    productId: selectedProductId,
  });
  const editedReq = useApi<ContentDraft[]>('/api/content-drafts?status=edited&kind=post', {
    productId: selectedProductId,
  });
  const usedReq = useApi<ContentDraft[]>('/api/content-drafts?status=used&kind=post', {
    productId: selectedProductId,
  });
  const discardedReq = useApi<ContentDraft[]>('/api/content-drafts?status=discarded&kind=post', {
    productId: selectedProductId,
  });

  const requestsByStatus = useMemo(
    () => ({
      pending: pendingReq,
      edited: editedReq,
      used: usedReq,
      discarded: discardedReq,
    }),
    [pendingReq, editedReq, usedReq, discardedReq],
  );

  const counts = useMemo<Record<StatusFilter, number>>(
    () => ({
      pending: pendingReq.data?.length ?? 0,
      edited: editedReq.data?.length ?? 0,
      used: usedReq.data?.length ?? 0,
      discarded: discardedReq.data?.length ?? 0,
    }),
    [pendingReq.data, editedReq.data, usedReq.data, discardedReq.data],
  );

  const totalGenerated = counts.pending + counts.edited + counts.used + counts.discarded;
  const usageRate = totalGenerated > 0 ? Math.round((counts.used / totalGenerated) * 100) : 0;

  const refetchAll = useCallback(() => {
    pendingReq.refetch();
    editedReq.refetch();
    usedReq.refetch();
    discardedReq.refetch();
  }, [pendingReq, editedReq, usedReq, discardedReq]);

  const resetFilters = useCallback(() => {
    setSearch('');
    setSourceFilter('all');
    setSortKey('recent');
  }, []);

  const hasActiveFilters = search.trim().length > 0 || sourceFilter !== 'all';

  const handleGenerate = useCallback(
    async (id: string, count: number, targetSource: TargetSource) => {
      if (!selectedProductId) {
        toast.error('Sélectionne un produit avant de générer.');
        return;
      }
      setGeneratingId(id);
      try {
        const res = await fetch(
          `/api/products/${encodeURIComponent(selectedProductId)}/content/generate-posts`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, targetSource }),
          },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          toast.error(json?.message || `Erreur HTTP ${res.status}`);
          return;
        }
        const generated = Array.isArray(json) ? json.length : count;
        toast.success(
          `${generated} draft${generated > 1 ? 's' : ''} généré${generated > 1 ? 's' : ''}.`,
        );
        setActiveTab('pending');
        refetchAll();
      } catch {
        toast.error('Erreur réseau lors de la génération.');
      } finally {
        setGeneratingId(null);
      }
    },
    [refetchAll, selectedProductId],
  );

  const generating = generatingId !== null;

  const anyLoading =
    (pendingReq.loading && !pendingReq.data) ||
    (editedReq.loading && !editedReq.data) ||
    (usedReq.loading && !usedReq.data) ||
    (discardedReq.loading && !discardedReq.data);

  const firstError = pendingReq.error || editedReq.error || usedReq.error || discardedReq.error;

  const lang: ContentLanguage = productReq.data?.content_language ?? 'fr';
  const langLabel = lang === 'en' ? 'anglais' : 'français';

  // Filter + sort drafts (count badges stay unfiltered API totals). Reused for
  // each tab inside the render loop so hidden panels stay self-consistent.
  const filterAndSort = useCallback(
    (drafts: ContentDraft[]): ContentDraft[] => {
      const term = search.trim().toLowerCase();
      const filtered = drafts.filter((d) => {
        if (sourceFilter !== 'all' && d.target_source !== sourceFilter) return false;
        if (term) {
          const haystack = `${d.edited_text ?? d.text} ${d.angle ?? ''}`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      });
      const sorted = [...filtered];
      sorted.sort((a, b) => {
        if (sortKey === 'recent') return b.generated_at - a.generated_at;
        if (sortKey === 'oldest') return a.generated_at - b.generated_at;
        const aLen = (a.edited_text ?? a.text).length;
        const bLen = (b.edited_text ?? b.text).length;
        return bLen - aLen;
      });
      return sorted;
    },
    [search, sourceFilter, sortKey],
  );

  // Active-tab visible count, shown in the toolbar.
  const activeVisibleCount = filterAndSort(requestsByStatus[activeTab].data ?? []).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Studio de contenu"
        description="Génère des drafts de posts pour ton produit. Tu valides, tu postes."
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatChip label="En attente" value={String(counts.pending)} />
        <StatChip label="Éditées" value={String(counts.edited)} />
        <StatChip label="Utilisées" value={String(counts.used)} />
        <StatChip label="Total générés" value={String(totalGenerated)} />
        <StatChip label="Taux d’utilisation" value={`${usageRate} %`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Générer des drafts</CardTitle>
          <CardDescription>
            Les drafts sont générés en {langLabel}, selon la voix et les infos du produit.
            Ajuste-les dans les paramètres du produit.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-5 space-y-4">
          {productReq.data && <ProductContextStrip product={productReq.data} />}

          <div className="flex flex-wrap items-end gap-2">
            <Select
              value={genSource}
              onValueChange={(v) => setGenSource(v as TargetSource)}
            >
              <SelectTrigger className="h-9 w-[150px]" aria-label="Plateforme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SOURCE_META) as TargetSource[]).map((src) => {
                  const meta = SOURCE_META[src];
                  const { Icon } = meta;
                  return (
                    <SelectItem key={src} value={src}>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className={cn('size-3.5', meta.textClass)} />
                        {meta.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <Select value={String(genCount)} onValueChange={(v) => setGenCount(Number(v))}>
              <SelectTrigger className="h-9 w-[110px]" aria-label="Nombre de drafts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} posts
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => handleGenerate('custom', genCount, genSource)}
              disabled={generating}
              size="sm"
              className="h-9"
            >
              {generatingId === 'custom' ? (
                <Loader2 className="size-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="size-3.5 mr-1" />
              )}
              {generatingId === 'custom' ? 'Génération…' : 'Générer'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Préréglages :</span>
            {GENERATE_PRESETS.map((preset) => {
              const meta = SOURCE_META[preset.source];
              const { Icon } = meta;
              const isThisGenerating = generatingId === preset.key;
              return (
                <Button
                  key={preset.key}
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => handleGenerate(preset.key, preset.count, preset.source)}
                  disabled={generating}
                >
                  {isThisGenerating ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Icon className={cn('size-3.5 mr-1', meta.textClass)} />
                  )}
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {firstError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>Impossible de charger les drafts : {firstError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as StatusFilter)}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto flex-nowrap gap-1 w-max">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 shrink-0">
                <span>{tab.label}</span>
                {counts[tab.id] > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">
                    {counts[tab.id]}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher dans les drafts…"
              className="h-9 pl-8"
              aria-label="Rechercher dans les drafts"
            />
          </div>

          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
            <SelectTrigger className="h-9 w-[170px]" aria-label="Filtrer par source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Trier">
              <ArrowDownUp className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground tabular-nums">
            {activeVisibleCount} draft{activeVisibleCount > 1 ? 's' : ''}
          </span>
        </div>

        {TABS.map((tab) => {
          const req = requestsByStatus[tab.id];
          const drafts = req.data ?? [];
          const visible = filterAndSort(drafts);
          const loading = anyLoading && !req.data;
          return (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-40 w-full rounded-xl" />
                  ))}
                </div>
              ) : drafts.length === 0 ? (
                <EmptyState title={tab.emptyTitle} hint={tab.emptyHint} />
              ) : visible.length === 0 ? (
                hasActiveFilters ? (
                  <NoResultsState onReset={resetFilters} />
                ) : (
                  <EmptyState title={tab.emptyTitle} hint={tab.emptyHint} />
                )
              ) : (
                <DraftsList drafts={visible} onMutated={refetchAll} />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
