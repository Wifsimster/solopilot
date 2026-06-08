import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '@/hooks/use-api';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Save,
  Globe,
  Mic,
  Link2,
  ExternalLink,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatRelativeFr } from '@/lib/utils';
import type {
  ContentDraft,
  ContentDraftStatus,
  ContentLanguage,
  ContentVoice,
  ProductRecord,
  TargetSource,
} from '@/types';

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

// Character budgets per platform, mirroring the backend generation prompt
// (src/content-studio.ts → platformConstraints). X enforces a hard 280-char
// cap; reddit/generic are soft "recommended" ceilings. The live counter uses
// these to warn before the user pastes something the platform will reject.
const PLATFORM_LIMITS: Record<TargetSource, number> = {
  x: 280,
  reddit: 500,
  generic: 500,
};

const VOICE_LABELS: Record<ContentVoice, string> = {
  decontractee: 'Décontractée',
  professionnelle: 'Professionnelle',
  directe: 'Directe',
  aidante: 'Aidante',
};

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

  return (
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="brand" className="text-[10px] px-1.5 py-0">
              {targetSourceLabel(draft.target_source)}
            </Badge>
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
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Wand2 className="size-5 text-muted-foreground" />
        </div>
        <p className="font-medium">{emptyTitle}</p>
        <p className="text-sm text-muted-foreground max-w-xs">{emptyHint}</p>
      </div>
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
  const [generating, setGenerating] = useState<TargetSource | null>(null);

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
      setGenerating(targetSource);
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
        setGenerating(null);
      }
    },
    [refetchAll, selectedProductId],
  );

  const anyLoading =
    (pendingReq.loading && !pendingReq.data) ||
    (editedReq.loading && !editedReq.data) ||
    (usedReq.loading && !usedReq.data) ||
    (discardedReq.loading && !discardedReq.data);

  const firstError = pendingReq.error || editedReq.error || usedReq.error || discardedReq.error;

  const lang: ContentLanguage = productReq.data?.content_language ?? 'fr';
  const langLabel = lang === 'en' ? 'anglais' : 'français';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Studio de contenu"
        description="Génère des drafts de posts pour ton produit. Tu valides, tu postes."
      />

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
          <div className="flex flex-wrap items-center gap-2">
            {GENERATE_BUTTONS.map((btn) => {
              const isThisGenerating = generating === btn.source;
              return (
                <Button
                  key={btn.key}
                  onClick={() => handleGenerate(btn.count, btn.source)}
                  disabled={generating !== null}
                  size="sm"
                >
                  {isThisGenerating ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5 mr-1" />
                  )}
                  {isThisGenerating ? 'Génération…' : btn.label}
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

        {TABS.map((tab) => {
          const req = requestsByStatus[tab.id];
          const drafts = req.data ?? [];
          return (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {anyLoading && !req.data ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-40 w-full rounded-xl" />
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
