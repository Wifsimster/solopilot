import { useState, useEffect, useRef, useCallback } from 'react';
import { useApi } from '@/hooks/use-api';
import { StatusBadge } from '@/components/status-badge';
import { StatCard } from '@/components/stat-card';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import {
  Activity,
  Timer,
  CalendarClock,
  ArrowRight,
  Play,
  AlertCircle,
} from 'lucide-react';
import { humanizeCron, nextCronDate, formatTimeUntil } from '@/lib/utils';
import { ConfirmDialog } from '@/components/responsive-dialog';
import { MarkdownContent } from '@/components/markdown-content';
import { toast } from 'sonner';
import { useSelectedProduct, withProductId } from '@/lib/product-context-hooks';
import type { StatusResponse } from '@/types';

const POLL_INTERVAL_MS = 4_000;

function isCookieError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /401|403|404|Session cookies/i.test(message);
}

export function DashboardPage() {
  const { selectedProductId } = useSelectedProduct();
  const { data: status, loading, error, refetch } = useApi<StatusResponse>('/api/status', {
    productId: selectedProductId,
  });
  const [triggering, setTriggering] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasRunning = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => refetch(), POLL_INTERVAL_MS);
  }, [refetch, stopPolling]);

  useEffect(() => {
    const isActive = status?.running || status?.collecting;
    if (isActive && !pollRef.current) {
      startPolling();
      wasRunning.current = true;
    } else if (!isActive && wasRunning.current) {
      stopPolling();
      wasRunning.current = false;
      setLiveMessage('Run terminé — résultats à jour ci-dessous.');
      refetch();
    }
    return stopPolling;
  }, [status?.running, status?.collecting, startPolling, stopPolling, refetch]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const res = await fetch(withProductId('/api/trigger', selectedProductId), {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setLiveMessage('Run démarré.');
        startPolling();
        wasRunning.current = true;
      } else {
        toast.error(data.message);
      }
      setTimeout(() => refetch(), 1000);
    } catch {
      toast.error('Erreur lors du déclenchement du run.');
    } finally {
      setTriggering(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Supervision du bot X AI Weekly" />
        <ErrorState
          message={error}
          context="Impossible de charger le statut"
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!status) return null;

  const { lastRun, cronSchedule, running, totalRuns } = status;
  const nextRun = nextCronDate(cronSchedule);
  const nextRunLabel = nextRun ? formatTimeUntil(nextRun) : null;
  const cookiesExpired = isCookieError(lastRun?.error_message);

  return (
    <div className="space-y-6">
      <output className="sr-only" aria-live="polite">
        {liveMessage}
      </output>

      <PageHeader
        title="Dashboard"
        description="Supervision du bot X AI Weekly"
        actions={
          <ConfirmDialog
            trigger={
              <Button
                disabled={running || triggering}
                aria-label="Lancer un run maintenant"
                className="hidden sm:inline-flex"
              >
                <Play className="size-4" aria-hidden="true" />
                {running || triggering ? 'Run en cours…' : 'Lancer un run'}
              </Button>
            }
            title="Lancer un run maintenant ?"
            description="Cette action va déclencher un scraping de votre timeline X et générer un résumé IA des actualités."
            confirmLabel="Lancer le run"
            onConfirm={handleTrigger}
          />
        }
      />

      {cookiesExpired && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" />
          <AlertTitle>Session cookies expirés</AlertTitle>
          <AlertDescription>
            Vos cookies de session X semblent avoir expiré.{' '}
            <Link to="/settings" className="underline font-medium">
              Mettez-les à jour dans Paramètres
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Statut actuel"
          icon={Activity}
          tone={running ? 'warning' : 'success'}
        >
          {running ? <StatusBadge status="running" /> : <span>Inactif</span>}
        </StatCard>
        <StatCard
          title="Prochain run"
          icon={Timer}
          hint={humanizeCron(cronSchedule)}
        >
          {running ? (
            <StatusBadge status="running" />
          ) : nextRunLabel ? (
            <span>dans {nextRunLabel}</span>
          ) : (
            <span className="text-muted-foreground">{'—'}</span>
          )}
        </StatCard>
        <StatCard title="Runs cumulés" icon={CalendarClock}>
          <span className="tabular-nums">{totalRuns}</span>
        </StatCard>
      </div>

      {lastRun ? (
        <Card>
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Dernier run · #{lastRun.id}
                </p>
                <p className="text-base font-semibold">{lastRun.started_at}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={lastRun.status} />
                <span className="text-sm text-muted-foreground">
                  {lastRun.tweets_fetched} message{lastRun.tweets_fetched !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {lastRun.summary && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Synthèse de la veille
                </p>
                <MarkdownContent content={lastRun.summary} className="text-sm" />
              </div>
            )}

            {lastRun.error_message && (
              <details className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <summary className="cursor-pointer font-medium text-destructive text-sm">
                  Détail de l'erreur
                </summary>
                <pre className="mt-2 rounded bg-background p-3 text-xs overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {lastRun.error_message}
                </pre>
              </details>
            )}

            <div className="flex flex-wrap gap-2 pt-1 border-t -mx-5 sm:-mx-6 px-5 sm:px-6 -mb-1">
              <Button asChild variant="ghost" size="sm">
                <Link to="/summaries" className="gap-1">
                  Toutes les synthèses
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/runs" className="gap-1">
                  Historique complet
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-muted-foreground">Aucun run enregistré pour le moment.</p>
            <p className="text-sm text-muted-foreground">
              Lancez un premier run pour voir apparaître ici votre synthèse IA.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Mobile FAB — primary action stays reachable */}
      <ConfirmDialog
        trigger={
          <Button
            size="lg"
            disabled={running || triggering}
            aria-label="Lancer un run maintenant"
            className="sm:hidden fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-30 size-14 rounded-full shadow-lg p-0"
          >
            <Play className="size-5" aria-hidden="true" />
          </Button>
        }
        title="Lancer un run maintenant ?"
        description="Cette action va déclencher un scraping de votre timeline X et générer un résumé IA des actualités."
        confirmLabel="Lancer le run"
        onConfirm={handleTrigger}
      />
    </div>
  );
}
