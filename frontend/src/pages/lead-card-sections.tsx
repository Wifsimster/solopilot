import { useCallback, useRef, useState } from 'react';
import { formatRelativeFr } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  BellOff,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  Sparkles,
  Copy,
  RefreshCw,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import type { IntentSignal, IntentSignalReply, IntentSignalStatus } from '@/types';

function scoreBadgeVariant(score: number): 'secondary' | 'warning' | 'success' {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'secondary';
}

function ReplyVariantCard({
  reply,
  onToggleUsed,
}: {
  reply: IntentSignalReply;
  onToggleUsed: (replyId: number, used: boolean) => Promise<void>;
}) {
  const initialText = reply.text;
  const [text, setText] = useState(initialText);
  const [toggling, setToggling] = useState(false);

  // Keep the local editable textarea in sync with the server value if the
  // upstream reply changes (e.g. after a refetch) but preserve in-flight edits.
  // The last synced value lives in a ref (it is never rendered) and the sync is
  // performed during render rather than in an effect to avoid an extra pass.
  const lastSyncedTextRef = useRef(initialText);
  const incomingText = reply.text;
  if (incomingText !== lastSyncedTextRef.current) {
    if (text === lastSyncedTextRef.current) {
      setText(incomingText);
    }
    lastSyncedTextRef.current = incomingText;
  }

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
      className={[
        'rounded-lg border bg-muted/30 p-3 space-y-2 transition-colors',
        reply.used ? 'border-l-4 border-l-success bg-success/5' : 'border-border',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {reply.angle ? (
          <Badge
            variant={reply.used ? 'success' : 'outline'}
            className="text-[10px] px-1.5 py-0"
          >
            {reply.used && <Check className="size-3 mr-1" />}
            {reply.angle}
          </Badge>
        ) : (
          reply.used && (
            <Badge variant="success" className="text-[10px] px-1.5 py-0">
              <Check className="size-3 mr-1" />
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
          <Copy className="size-3.5 mr-1" />
          Copier
        </Button>
        <Button
          variant={reply.used ? 'secondary' : 'outline'}
          size="sm"
          className="h-7"
          onClick={handleToggleUsed}
          disabled={toggling}
        >
          {toggling ? (
            <Loader2 className="size-3.5 mr-1 animate-spin" />
          ) : reply.used ? (
            <Check className="size-3.5 mr-1" />
          ) : (
            <CheckCircle2 className="size-3.5 mr-1" />
          )}
          {reply.used ? 'Marquée utilisée' : 'Marquer utilisée'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Status action buttons for a lead (snooze / replied / dismissed, or reactivate).
 * Owns the in-flight "busy" state for the action currently being applied so the
 * parent card no longer has to track it.
 */
export function LeadActions({
  signal,
  onMutate,
}: {
  signal: IntentSignal;
  onMutate: (
    id: number,
    patch: Partial<Pick<IntentSignal, 'status' | 'notes'>>,
  ) => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<IntentSignalStatus | null>(null);

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

  return (
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
              <Loader2 className="size-3.5 mr-1 animate-spin" />
            ) : (
              <BellOff className="size-3.5 mr-1" />
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
              <Loader2 className="size-3.5 mr-1 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5 mr-1" />
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
              <Loader2 className="size-3.5 mr-1 animate-spin" />
            ) : (
              <XCircle className="size-3.5 mr-1" />
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
            <Loader2 className="size-3.5 mr-1 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5 mr-1" />
          )}
          Réactiver
        </Button>
      )}
    </div>
  );
}


/**
 * Small reusable button that asks the AI to (re)generate reply variants.
 * The surrounding analyzed-results sections only differ by their label.
 */
function GenerateVariantsButton({
  label,
  onGenerate,
  generating,
  variant = 'outline',
}: {
  label: string;
  onGenerate: () => void;
  generating: boolean;
  variant?: 'outline' | 'ghost';
}) {
  return (
    <div className="flex justify-end">
      <Button
        variant={variant}
        size="sm"
        className="h-7 text-xs"
        onClick={onGenerate}
        disabled={generating}
      >
        {generating ? (
          <>
            <Loader2 className="size-3 mr-1 animate-spin" />
            Génération…
          </>
        ) : (
          <>
            <Sparkles className="size-3 mr-1" />
            {label}
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * Results of a completed AI analysis: score, explanation, reply variants (or
 * the legacy single draft / no-reply recommendation) and the reanalyze button.
 * Owns the in-flight variant-generation state and the editable legacy draft.
 */
function LeadAiAnalyzed({
  signal,
  onAnalyzed,
  onAnalyze,
  analyzing,
}: {
  signal: IntentSignal;
  onAnalyzed: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const initialLegacyReply = signal.ai_drafted_reply ?? '';
  const [legacyReplyDraft, setLegacyReplyDraft] = useState(initialLegacyReply);

  // Keep the editable legacy reply textarea in sync with the latest server
  // value when a (re)analyze produces a new draft, but preserve in-flight edits.
  // The last synced value lives in a ref (it is never rendered) and the sync is
  // performed during render rather than in an effect to avoid an extra pass.
  const lastSyncedLegacyReplyRef = useRef<string | null>(signal.ai_drafted_reply);
  const incomingLegacyReply = signal.ai_drafted_reply;
  if (incomingLegacyReply !== lastSyncedLegacyReplyRef.current) {
    if (legacyReplyDraft === (lastSyncedLegacyReplyRef.current ?? '')) {
      setLegacyReplyDraft(incomingLegacyReply ?? '');
    }
    lastSyncedLegacyReplyRef.current = incomingLegacyReply;
  }

  const handleCopyLegacyReply = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(legacyReplyDraft);
      toast.success('Copié!');
    } catch {
      toast.error('Impossible de copier le brouillon.');
    }
  }, [legacyReplyDraft]);

  const handleGenerateVariants = useCallback(async () => {
    if (generatingVariants) return;
    setGeneratingVariants(true);
    try {
      const res = await fetch(
        `/api/intent-signals/${signal.id}/replies/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 3 }),
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
  }, [generatingVariants, onAnalyzed, signal.id]);

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

  const replies = signal.replies ?? [];
  const hasVariants = replies.length > 0;
  const hasLegacyReply = !hasVariants && signal.ai_drafted_reply !== null;
  const aiRecommendsNoReply =
    !hasVariants &&
    !hasLegacyReply &&
    signal.ai_score !== null &&
    signal.ai_score < 40;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          variant={scoreBadgeVariant(signal.ai_score ?? 0)}
          className="text-[11px] tabular-nums"
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
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
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
          <GenerateVariantsButton
            label="Générer 3 autres"
            onGenerate={handleGenerateVariants}
            generating={generatingVariants}
          />
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
              <Copy className="size-3.5 mr-1" />
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
            Brouillon généré par IA : relis et adapte avant de poster.
          </p>
          <GenerateVariantsButton
            label="Générer 3 variantes"
            onGenerate={handleGenerateVariants}
            generating={generatingVariants}
          />
        </div>
      )}

      {aiRecommendsNoReply && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground italic">
            L'IA recommande de ne pas répondre à ce lead.
          </p>
          <GenerateVariantsButton
            label="Générer quand même 3 variantes"
            onGenerate={handleGenerateVariants}
            generating={generatingVariants}
            variant="ghost"
          />
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onAnalyze}
          disabled={analyzing}
        >
          {analyzing ? (
            <>
              <Loader2 className="size-3 mr-1 animate-spin" />
              Analyse en cours…
            </>
          ) : (
            <>
              <RefreshCw className="size-3 mr-1" />
              Réanalyser
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * AI analysis block for a lead. Owns the analysis in-flight state and routes to
 * the right sub-section depending on whether the lead has been analyzed yet,
 * succeeded, or errored.
 */
export function LeadAiSection({
  signal,
  onAnalyzed,
}: {
  signal: IntentSignal;
  onAnalyzed: () => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);

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

  const aiAnalyzed = signal.ai_score !== null;
  const aiHasError = signal.ai_error !== null;
  const aiNotYetAnalyzed = !aiAnalyzed && !aiHasError;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
      {aiNotYetAnalyzed && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            L'IA peut scorer ce lead et proposer un brouillon de réponse.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <Loader2 className="size-3.5 mr-1 animate-spin" />
                Analyse en cours…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5 mr-1" />
                Analyser avec l'IA
              </>
            )}
          </Button>
        </div>
      )}

      {aiAnalyzed && (
        <LeadAiAnalyzed
          signal={signal}
          onAnalyzed={onAnalyzed}
          onAnalyze={handleAnalyze}
          analyzing={analyzing}
        />
      )}

      {aiHasError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 space-y-2">
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
                  <Loader2 className="size-3 mr-1 animate-spin" />
                  Analyse en cours…
                </>
              ) : (
                <>
                  <RefreshCw className="size-3 mr-1" />
                  Réessayer
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
