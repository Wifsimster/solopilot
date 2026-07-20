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
import { PageHeader } from '@/components/page-header';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Flame,
  Radar,
  RotateCcw,
  X as XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { VeilleItem, VeilleItemStatus } from '@/types';

const TEXT_TRUNCATE_AT = 280;
const FETCH_LIMIT = 200;
export const URGENT_THRESHOLD = 80;

type TabConfig = {
  id: VeilleItemStatus;
  label: string;
  emptyTitle: string;
  emptyHint: string;
};

const TABS: TabConfig[] = [
  {
    id: 'new',
    label: 'Nouvelles',
    emptyTitle: 'Aucune mention à traiter.',
    emptyHint: 'Active le triage IA dans la page Produits pour scorer chaque mention collectée.',
  },
  {
    id: 'handled',
    label: 'Traitées',
    emptyTitle: 'Aucune mention traitée.',
    emptyHint: 'Marque une mention comme traitée pour suivre ce qui a été géré.',
  },
  {
    id: 'ignored',
    label: 'Ignorées',
    emptyTitle: 'Aucune mention ignorée.',
    emptyHint: 'Les mentions hors-sujet apparaîtront ici une fois écartées.',
  },
];

const SOURCE_LABELS: Record<string, string> = { x: 'X', reddit: 'Reddit', hn: 'HN', youtube: 'YouTube' };

/** Human labels for the default AI triage taxonomy; custom slugs fall through prettified. */
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  temoignage: 'Témoignage',
  demande_fonctionnalite: 'Demande de fonctionnalité',
  objection: 'Objection',
  question: 'Question',
  actualite: 'Actualité',
  autre: 'Autre',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll('_', ' ');
}

function UrgencyBadge({ urgency }: { urgency: number | null }) {
  if (urgency === null) return null;
  const variant = urgency >= URGENT_THRESHOLD ? 'destructive' : urgency >= 40 ? 'warning' : 'secondary';
  return (
    <Badge variant={variant} className="gap-1 text-[10px] px-1.5 py-0 tabular-nums">
      {urgency >= URGENT_THRESHOLD && <Flame className="size-3" aria-hidden="true" />}
      {urgency}/100
    </Badge>
  );
}

function MentionCard({
  item,
  onMutate,
}: {
  item: VeilleItem;
  onMutate: (id: string, status: VeilleItemStatus) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mutating, setMutating] = useState(false);

  const isLong = item.text.length > TEXT_TRUNCATE_AT;
  const displayedText = expanded || !isLong ? item.text : `${item.text.slice(0, TEXT_TRUNCATE_AT)}…`;

  const mutate = useCallback(
    async (status: VeilleItemStatus) => {
      setMutating(true);
      try {
        await onMutate(item.id, status);
      } finally {
        setMutating(false);
      }
    },
    [item.id, onMutate],
  );

  return (
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="text-[10px] px-1.5 py-0">
              {SOURCE_LABELS[item.source] ?? item.source}
            </Badge>
            <UrgencyBadge urgency={item.triage_urgency} />
            {item.triage_category && (
              <Badge variant="secondary" className="text-[11px]">
                {categoryLabel(item.triage_category)}
              </Badge>
            )}
            {item.triaged_at === null && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                En attente d'analyse IA
              </Badge>
            )}
            <span className="text-sm font-medium">{item.author || 'Anonyme'}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeFr(Date.parse(item.created_at))}
            </span>
          </div>
          {item.url && (
            <a
              href={item.url}
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

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
          {item.triage_status === 'new' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={mutating}
                onClick={() => mutate('ignored')}
              >
                <XIcon className="size-3.5 mr-1" aria-hidden="true" />
                Ignorer
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={mutating}
                onClick={() => mutate('handled')}
              >
                <Check className="size-3.5 mr-1" aria-hidden="true" />
                Traité
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={mutating}
              onClick={() => mutate('new')}
            >
              <RotateCcw className="size-3.5 mr-1" aria-hidden="true" />
              Rouvrir
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Single-select chip rows to filter the active tab by category / source / urgency. */
function MentionFilterBar({
  categories,
  activeCategory,
  onCategoryChange,
  urgentOnly,
  onUrgentToggle,
}: {
  categories: { value: string; count: number }[];
  activeCategory: string;
  onCategoryChange: (value: string) => void;
  urgentOnly: boolean;
  onUrgentToggle: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant={urgentOnly ? 'default' : 'outline'}
        size="sm"
        className="h-7 text-xs"
        onClick={onUrgentToggle}
      >
        <Flame className="size-3.5 mr-1" aria-hidden="true" />
        Urgentes
      </Button>
      {categories.length > 0 && (
        <>
          <Button
            variant={activeCategory === 'all' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => onCategoryChange('all')}
          >
            Toutes
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.value}
              variant={activeCategory === cat.value ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onCategoryChange(cat.value)}
            >
              {categoryLabel(cat.value)}
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 tabular-nums">
                {cat.count}
              </Badge>
            </Button>
          ))}
        </>
      )}
    </div>
  );
}

function MentionsList({
  items,
  emptyTitle,
  emptyHint,
  onMutate,
}: {
  items: VeilleItem[];
  emptyTitle: string;
  emptyHint: string;
  onMutate: (id: string, status: VeilleItemStatus) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Radar className="size-5 text-muted-foreground" />
        </div>
        <p className="font-medium">{emptyTitle}</p>
        <p className="text-sm text-muted-foreground max-w-xs">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <MentionCard key={item.id} item={item} onMutate={onMutate} />
      ))}
    </div>
  );
}

export function MentionsPage() {
  const { selectedProductId } = useSelectedProduct();
  const [activeTab, setActiveTab] = useState<VeilleItemStatus>('new');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [urgentOnly, setUrgentOnly] = useState(false);

  // One request per status so tab badges show counts; the "new" tab is served
  // urgency-first (that is the work queue), the others chronologically.
  const newReq = useApi<VeilleItem[]>(
    `/api/veille/items?status=new&sort=urgency&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );
  const handledReq = useApi<VeilleItem[]>(
    `/api/veille/items?status=handled&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );
  const ignoredReq = useApi<VeilleItem[]>(
    `/api/veille/items?status=ignored&limit=${FETCH_LIMIT}`,
    { productId: selectedProductId },
  );

  const requestsByStatus = useMemo(
    () => ({ new: newReq, handled: handledReq, ignored: ignoredReq }),
    [newReq, handledReq, ignoredReq],
  );

  const counts = useMemo<Record<VeilleItemStatus, number>>(
    () => ({
      new: newReq.data?.length ?? 0,
      handled: handledReq.data?.length ?? 0,
      ignored: ignoredReq.data?.length ?? 0,
    }),
    [newReq.data, handledReq.data, ignoredReq.data],
  );

  const activeItems = useMemo(
    () => requestsByStatus[activeTab].data ?? [],
    [requestsByStatus, activeTab],
  );
  const categoryCounts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const item of activeItems) {
      if (item.triage_category) {
        tally.set(item.triage_category, (tally.get(item.triage_category) ?? 0) + 1);
      }
    }
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count }));
  }, [activeItems]);

  const handleMutate = useCallback(
    async (id: string, status: VeilleItemStatus) => {
      try {
        const res = await fetch(`/api/veille/items/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          toast.error(json?.message || `Erreur HTTP ${res.status}`);
          return;
        }
        toast.success(
          status === 'handled'
            ? 'Mention marquée comme traitée.'
            : status === 'ignored'
              ? 'Mention ignorée.'
              : 'Mention rouverte.',
        );
        newReq.refetch();
        handledReq.refetch();
        ignoredReq.refetch();
      } catch {
        toast.error('Erreur réseau lors de la mise à jour.');
      }
    },
    [newReq, handledReq, ignoredReq],
  );

  const anyLoading =
    (newReq.loading && !newReq.data) ||
    (handledReq.loading && !handledReq.data) ||
    (ignoredReq.loading && !ignoredReq.data);

  const firstError = newReq.error || handledReq.error || ignoredReq.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mentions"
        description="Chaque mention collectée, scorée par l'IA — à travailler comme une boîte de réception"
      />

      {firstError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>Impossible de charger les mentions : {firstError}</AlertDescription>
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as VeilleItemStatus);
          // Filters are computed for the active tab only; reset so the new tab
          // never opens on an empty filtered list with no visible chip.
          setCategoryFilter('all');
          setUrgentOnly(false);
        }}
      >
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

        <div className="mt-3">
          <MentionFilterBar
            categories={categoryCounts}
            activeCategory={categoryFilter}
            onCategoryChange={setCategoryFilter}
            urgentOnly={urgentOnly}
            onUrgentToggle={() => setUrgentOnly((v) => !v)}
          />
        </div>

        {TABS.map((tab) => {
          const req = requestsByStatus[tab.id];
          const items = req.data ?? [];
          const isActive = tab.id === activeTab;
          const visibleItems = isActive
            ? items.filter(
                (item) =>
                  (categoryFilter === 'all' || item.triage_category === categoryFilter) &&
                  (!urgentOnly || (item.triage_urgency ?? 0) >= URGENT_THRESHOLD),
              )
            : items;
          const filtered = isActive && (categoryFilter !== 'all' || urgentOnly);
          return (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {anyLoading && !req.data ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <MentionsList
                  items={visibleItems}
                  emptyTitle={filtered ? 'Aucune mention ne correspond aux filtres.' : tab.emptyTitle}
                  emptyHint={
                    filtered
                      ? 'Retire les filtres pour revoir toutes les mentions de cet onglet.'
                      : tab.emptyHint
                  }
                  onMutate={handleMutate}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
