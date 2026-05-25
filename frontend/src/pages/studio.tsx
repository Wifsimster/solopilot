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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  Sparkles,
  Copy,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  Wand2,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ContentDraft, ContentDraftStatus, TargetSource } from '@/types';

type StatusFilter = ContentDraftStatus;

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
    emptyHint: 'Modifie le texte d\'un draft pour le retrouver ici.',
  },
  {
    id: 'used',
    label: 'Utilisées',
    emptyTitle: 'Aucun draft utilisé pour le moment.',
    emptyHint: 'Marque un draft comme utilisé après l\'avoir posté.',
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

function targetSourceLabel(source: TargetSource | null): string {
  if (source === 'x') return 'X';
  if (source === 'reddit') return 'Reddit';
  if (source === 'generic') return 'Generic';
  return 'Source ?';
}

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

function formatRelativeFr(epochSeconds: number | null | undefined): string {
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

interface DraftCardProps {
  draft: ContentDraft;
  onMutated: () => void;
}

function DraftCard({ draft, onMutated }: DraftCardProps) {
  const initialText = draft.edited_text ?? draft.text;
  const [text, setText] = useState(initialText);
  const [lastSavedText, setLastSavedText] = useState(initialText);
  const [usedOn, setUsedOn] = useState<string>(draft.used_on ?? 'x');
  const [busy, setBusy] = useState<ContentDraftStatus | 'save' | null>(null);

  // Keep textarea in sync if the server-side draft changes (e.g. after refetch)
  // while preserving in-flight user edits.
  useEffect(() => {
    const incoming = draft.edited_text ?? draft.text;
    if (incoming !== lastSavedText) {
      if (text === lastSavedText) {
        setText(incoming);
      }
      setLastSavedText(incoming);
    }
  }, [draft.edited_text, draft.text, lastSavedText, text]);

  const dirty = text !== lastSavedText && text.trim().length > 0;

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
          setLastSavedText(body.edited_text);
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
    await patch(
      { edited_text: text, status: 'edited' },
      'save',
      'Modifications enregistrées.',
    );
  }, [dirty, patch, text]);

  const handleBlur = useCallback(() => {
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
    await patch(
      { status: 'used', used_on: usedOn },
      'used',
      'Marquée comme utilisée.',
    );
  }, [patch, usedOn]);

  const handleDiscard = useCallback(async () => {
    await patch({ status: 'discarded' }, 'discarded', 'Draft jeté.');
  }, [patch]);

  const handleRestore = useCallback(async () => {
    await patch({ status: 'pending' }, 'pending', 'Draft restauré.');
  }, [patch]);

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {targetSourceLabel(draft.target_source)}
            </Badge>
            {draft.angle && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {draft.angle}
              </Badge>
            )}
            <Badge
              variant={statusBadgeVariant(draft.status)}
              className="text-[10px] px-1.5 py-0"
            >
              {statusLabel(draft.status)}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Générée {formatRelativeFr(draft.generated_at)}
          </span>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          rows={5}
          aria-label="Texte du draft"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleCopy}
              disabled={!text.trim()}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
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
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1" />
                )}
                Sauvegarder
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draft.status !== 'used' && (
              <>
                <Select value={usedOn} onValueChange={setUsedOn}>
                  <SelectTrigger
                    className="h-8 w-[110px] text-xs"
                    aria-label="Plateforme utilisée"
                  >
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
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
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
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 mr-1" />
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
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
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

function DraftsList({
  drafts,
  emptyTitle,
  emptyHint,
  onMutated,
}: {
  drafts: ContentDraft[];
  emptyTitle: string;
  emptyHint: string;
  onMutated: () => void;
}) {
  if (drafts.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <Wand2 className="h-8 w-8 mx-auto text-muted-foreground opacity-60" />
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{emptyHint}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} onMutated={onMutated} />
      ))}
    </div>
  );
}

type GenerateButton = {
  key: string;
  label: string;
  count: number;
  source: TargetSource;
};

const GENERATE_BUTTONS: GenerateButton[] = [
  { key: 'x', label: 'Générer 10 posts X', count: 10, source: 'x' },
  { key: 'reddit', label: 'Générer 10 posts Reddit', count: 10, source: 'reddit' },
  { key: 'generic', label: 'Générer 5 posts génériques', count: 5, source: 'generic' },
];

export function StudioPage() {
  const { selectedProductId } = useSelectedProduct();
  const [activeTab, setActiveTab] = useState<StatusFilter>('pending');
  const [generating, setGenerating] = useState(false);

  const pendingReq = useApi<ContentDraft[]>(
    '/api/content-drafts?status=pending&kind=post',
    { productId: selectedProductId },
  );
  const editedReq = useApi<ContentDraft[]>(
    '/api/content-drafts?status=edited&kind=post',
    { productId: selectedProductId },
  );
  const usedReq = useApi<ContentDraft[]>(
    '/api/content-drafts?status=used&kind=post',
    { productId: selectedProductId },
  );
  const discardedReq = useApi<ContentDraft[]>(
    '/api/content-drafts?status=discarded&kind=post',
    { productId: selectedProductId },
  );

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

  const refetchAll = useCallback(() => {
    pendingReq.refetch();
    editedReq.refetch();
    usedReq.refetch();
    discardedReq.refetch();
  }, [pendingReq, editedReq, usedReq, discardedReq]);

  const handleGenerate = useCallback(
    async (count: number, targetSource: TargetSource) => {
      if (!selectedProductId) {
        toast.error('Sélectionne un produit avant de générer.');
        return;
      }
      setGenerating(true);
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
        toast.success(`${generated} draft${generated > 1 ? 's' : ''} généré${generated > 1 ? 's' : ''}.`);
        refetchAll();
      } catch {
        toast.error('Erreur réseau lors de la génération.');
      } finally {
        setGenerating(false);
      }
    },
    [refetchAll, selectedProductId],
  );

  const anyLoading =
    (pendingReq.loading && !pendingReq.data) ||
    (editedReq.loading && !editedReq.data) ||
    (usedReq.loading && !usedReq.data) ||
    (discardedReq.loading && !discardedReq.data);

  const firstError =
    pendingReq.error || editedReq.error || usedReq.error || discardedReq.error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          Studio de contenu
        </h1>
        <p className="text-muted-foreground">
          Génère des drafts de posts pour ton produit. Tu valides, tu postes.
        </p>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {GENERATE_BUTTONS.map((btn) => (
              <Button
                key={btn.key}
                onClick={() => handleGenerate(btn.count, btn.source)}
                disabled={generating}
                size="sm"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                )}
                {btn.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Les drafts sont en français par défaut. Change la langue dans les
            paramètres du produit.
          </p>
        </CardContent>
      </Card>

      {firstError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Impossible de charger les drafts : {firstError}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as StatusFilter)}>
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
          const drafts = req.data ?? [];
          return (
            <TabsContent key={tab.id} value={tab.id} className="space-y-3">
              {anyLoading && !req.data ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-40 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <DraftsList
                  drafts={drafts}
                  emptyTitle={tab.emptyTitle}
                  emptyHint={tab.emptyHint}
                  onMutated={refetchAll}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
