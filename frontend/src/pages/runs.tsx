import { useState } from "react";
import { useApi } from "@/hooks/use-api";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MarkdownContent } from "@/components/markdown-content";
import { AlertCircle } from "lucide-react";
import { formatDateFr } from "@/lib/utils";
import { useSelectedProduct } from "@/lib/product-context";
import type { RunRecord } from "@/types";

const PAGE_SIZE = 20;

function SummaryToggle({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="ghost" size="sm" className="px-0 text-sm text-primary hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Masquer" : "Voir le résumé"}
      </Button>
      {open && (
        <div className="mt-2 max-w-md p-2 rounded bg-muted">
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            <span className="text-sm text-muted-foreground">#{run.id}</span>
          </div>
          <Badge variant="outline" className="text-xs">{run.tweets_fetched} messages</Badge>
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
            <Button variant="ghost" size="sm" className="px-0 text-sm text-primary hover:underline" onClick={() => setOpen(!open)}>
              {open ? "Masquer le résumé" : "Voir le résumé"}
            </Button>
            {open && (
              <div className="mt-2 p-2 rounded bg-muted">
                <MarkdownContent content={run.summary} className="text-xs" />
              </div>
            )}
          </div>
        )}
        {run.error_message && (
          <p className="text-xs text-destructive truncate">{run.error_message.slice(0, 120)}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function RunsPage() {
  const [page, setPage] = useState(0);
  const { selectedProductId } = useSelectedProduct();
  const { data, loading, error } = useApi<{ runs: RunRecord[]; total: number }>(
    `/api/runs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    { productId: selectedProductId }
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Historique des runs</h1>
          <p className="text-muted-foreground">Historique complet des exécutions du bot</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Impossible de charger l'historique des runs : {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Historique des runs</h1>
        <p className="text-muted-foreground">
          {total} run{total !== 1 ? "s" : ""} au total
        </p>
      </div>

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
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Début</TableHead>
              <TableHead>Fin</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Déclencheur</TableHead>
              <TableHead>Messages</TableHead>
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
                <TableCell className="font-medium">{run.id}</TableCell>
                <TableCell className="text-sm">{formatDateFr(run.started_at)}</TableCell>
                <TableCell className="text-sm">{formatDateFr(run.finished_at)}</TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell className="text-sm">{run.trigger_type}</TableCell>
                <TableCell>{run.tweets_fetched}</TableCell>
                <TableCell>
                  {run.summary ? (
                    <SummaryToggle summary={run.summary} />
                  ) : (
                    "\u2014"
                  )}
                </TableCell>
                <TableCell>
                  {run.error_message ? (
                    <span className="text-xs text-destructive">{run.error_message.slice(0, 80)}</span>
                  ) : (
                    "\u2014"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Précédent
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivant
          </Button>
        </div>
      )}
    </div>
  );
}
