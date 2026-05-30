import { useCallback, useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import { formatRelativeFr } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
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
    emptyHint: 'Snooze une opportunité depuis l’onglet Nouveaux pour la retrouver ici.',
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
  return 'X';
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
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
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

        {signal.matched_pattern && (
          <div>
            <Badge variant="success" className="text-[11px] font-mono">
              motif : {signal.matched_pattern}
            </Badge>
          </div>
        )}

        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
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

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="px-0 h-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setNotesOpen((v) => !v)}
          >
            <StickyNote className="size-3.5 mr-1" />
            {notesOpen ? 'Masquer la note' : 'Ajouter une note'}
          </Button>

          <LeadActions signal={signal} onMutate={onMutate} />
        </div>

        {notesOpen && (
          <div className="space-y-2 pt-1">
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
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <Target className="size-8 mx-auto text-muted-foreground opacity-60" />
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{emptyHint}</p>
        </CardContent>
      </Card>
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
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Opportunités</h1>
        <p className="text-muted-foreground">
          Signaux d'intention détectés sur tes sources
        </p>
      </div>

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
        onValueChange={(v) => setActiveTab(v as StatusFilter)}
      >
        <TabsList className="h-auto flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
              <span>{tab.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {counts[tab.id]}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

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
          return (
            <TabsContent key={tab.id} value={tab.id} className="space-y-3">
              {anyLoading && !req.data ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <LeadsList
                  signals={orderedSignals}
                  emptyTitle={tab.emptyTitle}
                  emptyHint={tab.emptyHint}
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
