import { useCallback, useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import { formatRelativeFr } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import { AlertCircle, ExternalLink, StickyNote, Loader2, Target } from 'lucide-react';
import { toast } from 'sonner';
import type { IntentSignal, IntentSignalStatus } from '@/types';
import { LeadActions, LeadAiSection } from './lead-card-sections';

const TEXT_TRUNCATE_AT = 280;
const FETCH_LIMIT = 100;

type StatusFilter = IntentSignalStatus;

type TabConfig = {
  id: StatusFilter;
  label: string;
  emptyTitle: string;
  emptyHint: string;
};

const TABS: TabConfig[] = [
  {
    id: 'new',
    label: 'Nouveaux',
    emptyTitle: 'Aucun nouveau signal.',
    emptyHint: 'Active le matching dans la page Produits.',
  },
  {
    id: 'snoozed',
    label: 'En attente',
    emptyTitle: 'Aucun signal en attente.',
    emptyHint: "Snooze une opportunité depuis l'onglet Nouveaux pour la retrouver ici.",
  },
  {
    id: 'replied',
    label: 'Traités',
    emptyTitle: 'Aucune opportunité marquée comme traitée.',
    emptyHint: 'Marque un signal comme répondu pour suivre tes interactions.',
  },
  {
    id: 'dismissed',
    label: 'Ignorés',
    emptyTitle: 'Aucun signal ignoré.',
    emptyHint: 'Les opportunités hors-sujet apparaîtront ici une fois écartées.',
  },
];

function sourceLabel(source: IntentSignal['source']): string {
  if (source === 'reddit') return 'Reddit';
  if (source === 'hn') return 'HN';
  if (source === 'youtube') return 'YouTube';
  return 'X';
}

// Human labels for the AI intent taxonomy (set by the analyze pass). Keys match
// the `ai_intent_category` values returned by the backend.
const CATEGORY_LABELS: Record<string, string> = {
  demande_active: 'Demande active',
  mention_concurrent: 'Mention concurrent',
  signal_douleur: 'Signal de douleur',
  question: 'Question',
  recommandation: 'Recommandation',
  autre: 'Autre',
};

// Canonical display order for the taxonomy filter chips.
const CATEGORY_ORDER = [
  'demande_active',
  'mention_concurrent',
  'signal_douleur',
  'question',
  'recommandation',
  'autre',
];

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Single-select chip row to filter the current tab's leads by AI intent
 * category. Counts and chips reflect the active tab only; renders nothing until
 * at least one lead in the tab has been classified.
 */
function CategoryFilterBar({
  categories,
  active,
  onChange,
}: {
  categories: { value: string; count: number }[];
  active: string;
  onChange: (value: string) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant={active === 'all' ? 'default' : 'outline'}
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange('all')}
      >
        Toutes
      </Button>
      {categories.map((cat) => (
        <Button
          key={cat.value}
          variant={active === cat.value ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onChange(cat.value)}
        >
          {categoryLabel(cat.value)}
          <Badge variant="secondary" className="ml-1.5 text-3xs px-1.5 py-0 tabular-nums">
            {cat.count}
          </Badge>
        </Button>
      ))}
    </div>
  );
}

function LeadCard({
  signal,
  onMutate,
  onAnalyzed,
}: {
  signal: IntentSignal;
  onMutate: (id: number, patch: Partial<Pick<IntentSignal, 'status' | 'notes'>>) => Promise<void>;
  onAnalyzed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(signal.notes !== null && signal.notes !== '');
  const [notesDraft, setNotesDraft] = useState(signal.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);

  const isLong = signal.text.length > TEXT_TRUNCATE_AT;
  const displayedText = expanded || !isLong ? signal.text : `${signal.text.slice(0, TEXT_TRUNCATE_AT)}…`;

  const handleSaveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const trimmed = notesDraft.trim();
      await onMutate(signal.id, { notes: trimmed === '' ? null : trimmed });
    } finally {
      setSavingNotes(false);
    }
  }, [notesDraft, onMutate, signal.id]);

  return (
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="text-3xs px-1.5 py-0">
              {sourceLabel(signal.source)}
            </Badge>
            <span className="text-sm font-medium">{signal.author || 'Anonyme'}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeFr(signal.created_at)}
            </span>
          </div>
          {signal.url && (
            <a
              href={signal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Ouvrir la source"
              title="Ouvrir la source"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>

        {(signal.matched_pattern || signal.ai_intent_category) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {signal.matched_pattern && (
              <Badge variant="success" className="font-mono text-2xs">
                motif : {signal.matched_pattern}
              </Badge>
            )}
            {signal.ai_intent_category && (
              <Badge variant="secondary" className="text-2xs">
                {categoryLabel(signal.ai_intent_category)}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
          {displayedText}
        </p>
        {isLong && (
          <Button
            variant="ghost"
            size="sm"
            className="px-0 h-auto text-xs text-primary hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Réduire' : 'Lire plus'}
          </Button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setNotesOpen((v) => !v)}
          >
            <StickyNote className="size-3.5 mr-1.5" />
            {notesOpen ? 'Masquer la note' : 'Ajouter une note'}
          </Button>

          <LeadActions signal={signal} onMutate={onMutate} />
        </div>

        {notesOpen && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Ajoute un contexte, un brouillon de réponse, etc."
              rows={3}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNotesDraft(signal.notes ?? '');
                  setNotesOpen(false);
                }}
                disabled={savingNotes}
              >
                Annuler
              </Button>
              <Button size="sm" onClick={handleSaveNotes} disabled={savingNotes}>
                {savingNotes ? (
                  <>
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                    Enregistrement…
                  </>
                ) : (
                  'Enregistrer la note'
                )}
              </Button>
            </div>
          </div>
        )}

        <LeadAiSection signal={signal} onAnalyzed={onAnalyzed} />
      </CardContent>
    </Card>
  );
}

function LeadsList({
  signals,
  emptyTitle,
  emptyHint,
  onMutate,
  onAnalyzed,
}: {
  signals: IntentSignal[];
  emptyTitle: string;
  emptyHint: string;
  onMutate: (id: number, patch: Partial<Pick<IntentSignal, 'status' | 'notes'>>) => Promise<void>;
  onAnalyzed: () => void;
}) {
  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Target className="size-5 text-muted-foreground" />
        </div>
        <p className="font-medium">{emptyTitle}</p>
        <p className="text-sm text-muted-foreground max-w-xs">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {signals.map((s) => (
        <LeadCard key={s.id} signal={s} onMutate={onMutate} onAnalyzed={onAnalyzed} />
      ))}
    </div>
  );
}

export function LeadsPage() {
  const { selectedProductId } = useSelectedProduct();
  const [activeTab, setActiveTab] = useState<StatusFilter>('new');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Fetch all statuses in parallel so the tab badges can show counts. Each tab
  // is a separate request so the backend remains a thin filter.
  const newReq = useApi<IntentSignal[]>(
    `/api/intent-signals?status=new&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );
  const snoozedReq = useApi<IntentSignal[]>(
    `/api/intent-signals?status=snoozed&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );
  const repliedReq = useApi<IntentSignal[]>(
    `/api/intent-signals?status=replied&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );
  const dismissedReq = useApi<IntentSignal[]>(
    `/api/intent-signals?status=dismissed&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );

  const requestsByStatus = useMemo(
    () => ({
      new: newReq,
      snoozed: snoozedReq,
      replied: repliedReq,
      dismissed: dismissedReq,
    }),
    [newReq, snoozedReq, repliedReq, dismissedReq],
  );

  const counts = useMemo<Record<StatusFilter, number>>(
    () => ({
      new: newReq.data?.length ?? 0,
      snoozed: snoozedReq.data?.length ?? 0,
      replied: repliedReq.data?.length ?? 0,
      dismissed: dismissedReq.data?.length ?? 0,
    }),
    [newReq.data, snoozedReq.data, repliedReq.data, dismissedReq.data],
  );

  // Taxonomy chips reflect the active tab only: count classified leads per
  // category and order them canonically.
  const activeSignals = requestsByStatus[activeTab].data ?? [];
  const categoryCounts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const s of activeSignals) {
      if (s.ai_intent_category) {
        tally.set(s.ai_intent_category, (tally.get(s.ai_intent_category) ?? 0) + 1);
      }
    }
    return CATEGORY_ORDER.filter((c) => tally.has(c)).map((value) => ({
      value,
      count: tally.get(value) ?? 0,
    }));
  }, [activeSignals]);

  const handleMutate = useCallback(
    async (id: number, patch: Partial<Pick<IntentSignal, 'status' | 'notes'>>) => {
      try {
        const res = await fetch(`/api/intent-signals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          toast.error(json?.message || `Erreur HTTP ${res.status}`);
          return;
        }
        if (patch.status) {
          toast.success('Statut mis à jour.');
        } else if ('notes' in patch) {
          toast.success('Note enregistrée.');
        }
        // Refetch every tab so counts and lists stay coherent after a move.
        newReq.refetch();
        snoozedReq.refetch();
        repliedReq.refetch();
        dismissedReq.refetch();
      } catch {
        toast.error('Erreur réseau lors de la mise à jour.');
      }
    },
    [newReq, snoozedReq, repliedReq, dismissedReq],
  );

  const anyLoading =
    (newReq.loading && !newReq.data) ||
    (snoozedReq.loading && !snoozedReq.data) ||
    (repliedReq.loading && !repliedReq.data) ||
    (dismissedReq.loading && !dismissedReq.data);

  const firstError =
    newReq.error || snoozedReq.error || repliedReq.error || dismissedReq.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opportunités"
        description="Signaux d'intention détectés sur tes sources"
      />

      {firstError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Impossible de charger les opportunités : {firstError}
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as StatusFilter);
          // A category present in one tab may be absent in another; reset so the
          // new tab never opens on an empty filtered list with no visible chip.
          setCategoryFilter('all');
        }}
      >
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto flex-nowrap gap-1 w-max">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 shrink-0">
                <span>{tab.label}</span>
                {counts[tab.id] > 0 && (
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0 tabular-nums">
                    {counts[tab.id]}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {categoryCounts.length > 0 && (
          <div className="mt-3">
            <CategoryFilterBar
              categories={categoryCounts}
              active={categoryFilter}
              onChange={setCategoryFilter}
            />
          </div>
        )}

        {TABS.map((tab) => {
          const req = requestsByStatus[tab.id];
          // On the "Nouveaux" tab, surface AI-analyzed leads first (highest
          // score first); leave the original (chronological) order otherwise.
          const signals = req.data ?? [];
          const orderedSignals =
            tab.id === 'new'
              ? signals.toSorted((a, b) => {
                  const aScored = a.ai_score !== null;
                  const bScored = b.ai_score !== null;
                  if (aScored !== bScored) return aScored ? -1 : 1;
                  if (aScored && bScored) {
                    return (b.ai_score ?? 0) - (a.ai_score ?? 0);
                  }
                  return 0;
                })
              : signals;
          // Apply the taxonomy filter only to the active tab — that is the only
          // tab whose chips/counts are computed, so others stay unfiltered.
          const visibleSignals =
            tab.id === activeTab && categoryFilter !== 'all'
              ? orderedSignals.filter((s) => s.ai_intent_category === categoryFilter)
              : orderedSignals;
          const filtered = tab.id === activeTab && categoryFilter !== 'all';
          return (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {anyLoading && !req.data ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <LeadsList
                  signals={visibleSignals}
                  emptyTitle={
                    filtered ? 'Aucun lead dans cette catégorie.' : tab.emptyTitle
                  }
                  emptyHint={
                    filtered
                      ? 'Choisis « Toutes » pour revoir tous les signaux de cet onglet.'
                      : tab.emptyHint
                  }
                  onMutate={handleMutate}
                  onAnalyzed={req.refetch}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
