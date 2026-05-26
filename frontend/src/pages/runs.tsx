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
import { useSelectedProduct } from '@/lib/product-context';
import type { RunRecord } from '@/types';

function SummaryToggle({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? 'Masquer' : 'Voir le résumé'}
      </Button>
      {open && (
        <div className="mt-2 max-w-md p-3 rounded-md bg-muted">
          <MarkdownContent content={summary} className="text-xs" />
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: RunRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <StatusBadge status={run.status} />
            <span className="text-sm text-muted-foreground tabular-nums">#{run.id}</span>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">
            {run.tweets_fetched} messages
          </Badge>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Début : </span>
          <span>{formatDateFr(run.started_at)}</span>
        </div>
        {run.trigger_type && (
          <div className="text-sm">
            <span className="text-muted-foreground">Déclencheur : </span>
            <span>{run.trigger_type}</span>
          </div>
        )}
        {run.summary && (
          <div>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-sm"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? 'Masquer le résumé' : 'Voir le résumé'}
            </Button>
            {open && (
              <div className="mt-2 p-3 rounded-md bg-muted">
                <MarkdownContent content={run.summary} className="text-xs" />
              </div>
            )}
          </div>
        )}
        {run.error_message && (
          <p className="text-xs text-destructive line-clamp-2">{run.error_message}</p>
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
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
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
        title="Historique des runs"
        description={`${total} run${total !== 1 ? 's' : ''} au total`}
      />

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {runs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Aucun run enregistré.
            </CardContent>
          </Card>
        ) : (
          runs.map((run) => <RunCard key={run.id} run={run} />)
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>Début</TableHead>
              <TableHead>Fin</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Déclencheur</TableHead>
              <TableHead className="text-right">Messages</TableHead>
              <TableHead>Résumé</TableHead>
              <TableHead>Erreur</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Aucun run enregistré.
                </TableCell>
              </TableRow>
            )}
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-medium tabular-nums">{run.id}</TableCell>
                <TableCell className="text-sm">{formatDateFr(run.started_at)}</TableCell>
                <TableCell className="text-sm">{formatDateFr(run.finished_at)}</TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell className="text-sm">{run.trigger_type}</TableCell>
                <TableCell className="text-right tabular-nums">{run.tweets_fetched}</TableCell>
                <TableCell>
                  {run.summary ? <SummaryToggle summary={run.summary} /> : '—'}
                </TableCell>
                <TableCell>
                  {run.error_message ? (
                    <span className="text-xs text-destructive line-clamp-2">
                      {run.error_message.slice(0, 80)}
                    </span>
                  ) : (
                    '—'
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
