import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Pagination } from '@/components/pagination';
import { MarkdownContent } from '@/components/markdown-content';
import { usePagination } from '@/hooks/use-pagination';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import { History } from 'lucide-react';
import type { RunRecord } from '@/types';

function SummaryToggle({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-sm text-primary"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? 'Masquer' : 'Voir le résumé'}
      </Button>
      {open && (
        <div className="mt-2 max-w-md rounded-lg border border-border bg-muted/40 p-3">
          <MarkdownContent content={summary} className="text-xs" />
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: RunRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge status={run.status} />
              <span className="text-xs text-muted-foreground tabular-nums font-medium">
                #{run.id}
              </span>
            </div>
            <p className="text-sm font-medium">{formatDateFr(run.started_at)}</p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0 tabular-nums">
            {run.tweets_fetched} messages
          </Badge>
        </div>

        {run.trigger_type && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium">Déclencheur :</span>
            <Badge variant="secondary" className="text-xs font-mono">
              {run.trigger_type}
            </Badge>
          </div>
        )}

        {run.summary && (
          <div>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-sm text-primary"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? 'Masquer le résumé' : 'Voir le résumé'}
            </Button>
            {open && (
              <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3">
                <MarkdownContent content={run.summary} className="text-xs" />
              </div>
            )}
          </div>
        )}

        {run.error_message && (
          <p className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive line-clamp-2">
            {run.error_message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function RunsPage() {
  const pagination = usePagination({ limit: 20 });
  const { selectedProductId } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<{ runs: RunRecord[]; total: number }>(
    `/api/runs?limit=${pagination.limit}&offset=${pagination.offset}`,
    { productId: selectedProductId },
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Veille"
          title="Historique des runs"
          description="Historique complet des exécutions du bot"
        />
        <ErrorState
          message={error}
          context="Impossible de charger l'historique"
          onRetry={refetch}
        />
      </div>
    );
  }

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const totalPages = pagination.totalPages(total);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Veille"
        title="Historique des runs"
        description={`${total} run${total !== 1 ? 's' : ''} au total`}
      />

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {runs.length === 0 ? (
          <Card>
            <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                <History className="size-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Aucun run enregistré</p>
                <p className="text-sm text-muted-foreground">
                  Les exécutions du bot apparaîtront ici.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          runs.map((run) => <RunCard key={run.id} run={run} />)
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[60px] font-semibold">#</TableHead>
              <TableHead className="font-semibold">Début</TableHead>
              <TableHead className="font-semibold">Fin</TableHead>
              <TableHead className="font-semibold">Statut</TableHead>
              <TableHead className="font-semibold">Déclencheur</TableHead>
              <TableHead className="text-right font-semibold">Messages</TableHead>
              <TableHead className="font-semibold">Résumé</TableHead>
              <TableHead className="font-semibold">Erreur</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                      <History className="size-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">Aucun run enregistré.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {runs.map((run) => (
              <TableRow key={run.id} className="hover:bg-muted/30">
                <TableCell className="font-medium tabular-nums text-muted-foreground">
                  {run.id}
                </TableCell>
                <TableCell className="text-sm">{formatDateFr(run.started_at)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateFr(run.finished_at)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  {run.trigger_type ? (
                    <Badge variant="secondary" className="text-xs font-mono">
                      {run.trigger_type}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {run.tweets_fetched}
                </TableCell>
                <TableCell>
                  {run.summary ? <SummaryToggle summary={run.summary} /> : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {run.error_message ? (
                    <span className="text-xs text-destructive line-clamp-2">
                      {run.error_message.slice(0, 80)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={pagination.page}
        totalPages={totalPages}
        onPrev={pagination.prev}
        onNext={pagination.next}
      />
    </div>
  );
}
