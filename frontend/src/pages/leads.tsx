import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { useSelectedProduct } from '@/lib/product-context';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertCircle,
  ExternalLink,
  BellOff,
  CheckCircle2,
  XCircle,
  RotateCcw,
  StickyNote,
  Loader2,
  Target,
  Sparkles,
  Copy,
  RefreshCw,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import type { IntentSignal, IntentSignalReply, IntentSignalStatus } from '@/types';

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

function scoreBadgeVariant(score: number): 'secondary' | 'warning' | 'success' {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'secondary';
}

function formatRelativeFr(epochSeconds: number): string {
  if (!epochSeconds) return '—';
  const ms = epochSeconds > 1e12 ? epochSeconds : epochSeconds * 1000;
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return 'à l’instant';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function ReplyVariantCard({
  reply,
  onToggleUsed,
}: {
  reply: IntentSignalReply;
  onToggleUsed: (replyId: number, used: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(reply.text);
  const [lastSyncedText, setLastSyncedText] = useState(reply.text);
  const [toggling, setToggling] = useState(false);

  // Keep the local editable textarea in sync with the server value if the
  // upstream reply changes (e.g. after a refetch) but preserve in-flight edits.
  useEffect(() => {
    if (reply.text !== lastSyncedText) {
      if (text === lastSyncedText) {
        setText(reply.text);
      }
      setLastSyncedText(reply.text);
    }
  }, [reply.text, lastSyncedText, text]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copié!');
    } catch {
      toast.error('Impossible de copier le brouillon.');
    }
  }, [text]);

  const handleToggleUsed = useCallback(async () => {
    setToggling(true);
    try {
      await onToggleUsed(reply.id, !reply.used);
    } finally {
      setToggling(false);
    }
  }, [onToggleUsed, reply.id, reply.used]);

  return (
    <div
      className={`rounded-md border bg-muted/30 p-3 space-y-2 ${
        reply.used ? 'border-l-4 border-l-emerald-500' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {reply.angle ? (
          <Badge
            variant={reply.used ? 'success' : 'outline'}
            className="text-[10px] px-1.5 py-0"
          >
            {reply.used && <Check className="h-3 w-3 mr-1" />}
            {reply.angle}
          </Badge>
        ) : (
          reply.used && (
            <Badge variant="success" className="text-[10px] px-1.5 py-0">
              <Check className="h-3 w-3 mr-1" />
              Utilisée
            </Badge>
          )
        )}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        aria-label="Variante de réponse"
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={handleCopy}
          disabled={!text.trim()}
        >
          <Copy className="h-3.5 w-3.5 mr-1" />
          Copier
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`h-7 ${
            reply.used
              ? 'border-emerald-500/60 text-emerald-700 dark:text-emerald-400 hover:text-emerald-700'
              : ''
          }`}
          onClick={handleToggleUsed}
          disabled={toggling}
        >
          {toggling ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : reply.used ? (
            <Check className="h-3.5 w-3.5 mr-1" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          )}
          {reply.used ? 'Marquée utilisée' : 'Marquer utilisée'}
        </Button>
      </div>
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
  const [busyAction, setBusyAction] = useState<IntentSignalStatus | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const [legacyReplyDraft, setLegacyReplyDraft] = useState(signal.ai_drafted_reply ?? '');
  const [lastSyncedLegacyReply, setLastSyncedLegacyReply] = useState<string | null>(
    signal.ai_drafted_reply,
  );

  // Keep the editable legacy reply textarea in sync with the latest server
  // value when a (re)analyze produces a new draft, but preserve in-flight edits.
  useEffect(() => {
    if (signal.ai_drafted_reply !== lastSyncedLegacyReply) {
      if (legacyReplyDraft === (lastSyncedLegacyReply ?? '')) {
        setLegacyReplyDraft(signal.ai_drafted_reply ?? '');
      }
      setLastSyncedLegacyReply(signal.ai_drafted_reply);
    }
  }, [signal.ai_drafted_reply, lastSyncedLegacyReply, legacyReplyDraft]);

  const isLong = signal.text.length > TEXT_TRUNCATE_AT;
  const displayedText = expanded || !isLong ? signal.text : `${signal.text.slice(0, TEXT_TRUNCATE_AT)}…`;

  const handleStatus = useCallback(
    async (status: IntentSignalStatus) => {
      setBusyAction(status);
      try {
        await onMutate(signal.id, { status });
      } finally {
        setBusyAction(null);
      }
    },
    [onMutate, signal.id],
  );

  const handleSaveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const trimmed = notesDraft.trim();
      await onMutate(signal.id, { notes: trimmed === '' ? null : trimmed });
    } finally {
      setSavingNotes(false);
    }
  }, [notesDraft, onMutate, signal.id]);

  const handleAnalyze = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/intent-signals/${signal.id}/analyze`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.message || `Erreur HTTP ${res.status}`);
        return;
      }
      onAnalyzed();
    } catch {
      toast.error("Erreur réseau lors de l'analyse.");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, signal.id, onAnalyzed]);

  const handleCopyLegacyReply = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(legacyReplyDraft);
      toast.success('Copié!');
    } catch {
      toast.error('Impossible de copier le brouillon.');
    }
  }, [legacyReplyDraft]);

  const handleGenerateVariants = useCallback(
    async (count: number) => {
      if (generatingVariants) return;
      setGeneratingVariants(true);
      try {
        const res = await fetch(
          `/api/intent-signals/${signal.id}/replies/generate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count }),
          },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json?.message || `Erreur HTTP ${res.status}`);
          return;
        }
        if (json?.success === false) {
          toast.error(json?.message || 'Échec de la génération.');
          return;
        }
        toast.success('Variantes générées.');
        onAnalyzed();
      } catch {
        toast.error('Erreur réseau lors de la génération.');
      } finally {
        setGeneratingVariants(false);
      }
    },
    [generatingVariants, onAnalyzed, signal.id],
  );

  const handleToggleReplyUsed = useCallback(
    async (replyId: number, used: boolean) => {
      try {
        const res = await fetch(`/api/intent-signal-replies/${replyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ used }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          toast.error(json?.message || `Erreur HTTP ${res.status}`);
          return;
        }
        toast.success(used ? 'Marquée utilisée.' : 'Marque retirée.');
        onAnalyzed();
      } catch {
        toast.error('Erreur réseau lors de la mise à jour.');
      }
    },
    [onAnalyzed],
  );

  const aiAnalyzed = signal.ai_score !== null;
  const aiHasError = signal.ai_error !== null;
  const aiNotYetAnalyzed = !aiAnalyzed && !aiHasError;
  const replies = signal.replies ?? [];
  const hasVariants = replies.length > 0;
  const hasLegacyReply = !hasVariants && signal.ai_drafted_reply !== null;
  const aiRecommendsNoReply =
    !hasVariants &&
    !hasLegacyReply &&
    signal.ai_score !== null &&
    signal.ai_score < 40;

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
              <ExternalLink className="h-4 w-4" />
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
            <StickyNote className="h-3.5 w-3.5 mr-1" />
            {notesOpen ? 'Masquer la note' : 'Ajouter une note'}
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            {signal.status === 'new' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => handleStatus('snoozed')}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'snoozed' ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <BellOff className="h-3.5 w-3.5 mr-1" />
                  )}
                  Snooze
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => handleStatus('replied')}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'replied' ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  )}
                  Marquer répondu
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={() => handleStatus('dismissed')}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'dismissed' ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                  )}
                  Ignorer
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => handleStatus('new')}
                disabled={busyAction !== null}
              >
                {busyAction === 'new' ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                )}
                Réactiver
              </Button>
            )}
          </div>
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
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  'Enregistrer la note'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* AI analysis section — visually distinct from the source / matched-pattern row */}
        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
          {aiNotYetAnalyzed && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                L'IA peut scorer ce lead et proposer un brouillon de réponse.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    Analyse en cours...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                    Analyser avec l'IA
                  </>
                )}
              </Button>
            </div>
          )}

          {aiAnalyzed && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge
                  variant={scoreBadgeVariant(signal.ai_score ?? 0)}
                  className="text-[11px]"
                >
                  Score IA : {signal.ai_score}/100
                </Badge>
                {signal.ai_processed_at !== null && (
                  <span className="text-xs text-muted-foreground">
                    Analysé {formatRelativeFr(signal.ai_processed_at)}
                  </span>
                )}
              </div>

              {signal.ai_explanation && (
                <div className="rounded-md border bg-background px-3 py-2">
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">
                    <span className="font-semibold">Pourquoi : </span>
                    {signal.ai_explanation}
                  </p>
                </div>
              )}

              {hasVariants && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">
                      Variantes de réponse ({replies.length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Relis et adapte avant de poster.
                    </p>
                  </div>
                  <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1">
                    {replies.map((reply) => (
                      <ReplyVariantCard
                        key={reply.id}
                        reply={reply}
                        onToggleUsed={handleToggleReplyUsed}
                      />
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleGenerateVariants(3)}
                      disabled={generatingVariants}
                    >
                      {generatingVariants ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Génération...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1" />
                          Générer 3 autres
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {hasLegacyReply && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor={`ai-reply-${signal.id}`}
                      className="text-xs font-medium"
                    >
                      Brouillon de réponse
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={handleCopyLegacyReply}
                      disabled={!legacyReplyDraft.trim()}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copier
                    </Button>
                  </div>
                  <Textarea
                    id={`ai-reply-${signal.id}`}
                    value={legacyReplyDraft}
                    onChange={(e) => setLegacyReplyDraft(e.target.value)}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Brouillon généré par IA — relis et adapte avant de poster.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleGenerateVariants(3)}
                      disabled={generatingVariants}
                    >
                      {generatingVariants ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Génération...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1" />
                          Générer 3 variantes
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {aiRecommendsNoReply && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground italic">
                    L'IA recommande de ne pas répondre à ce lead.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleGenerateVariants(3)}
                      disabled={generatingVariants}
                    >
                      {generatingVariants ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Génération...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1" />
                          Générer quand même 3 variantes
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Analyse en cours...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Réanalyser
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {aiHasError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 space-y-2">
              <p className="text-xs text-destructive">
                <span className="font-semibold">Échec de l'analyse : </span>
                {signal.ai_error}
              </p>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Analyse en cours...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Réessayer
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
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
          <Target className="h-8 w-8 mx-auto text-muted-foreground opacity-60" />
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
          <AlertCircle className="h-4 w-4" />
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
              ? [...signals].sort((a, b) => {
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
