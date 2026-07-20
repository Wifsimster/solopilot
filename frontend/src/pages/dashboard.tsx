import { useState, useEffect, useRef, useCallback } from 'react';
import { useApi } from '@/hooks/use-api';
import { StatusBadge } from '@/components/status-badge';
import { StatCard } from '@/components/stat-card';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import {
  Activity,
  Timer,
  CalendarClock,
  ArrowRight,
  Play,
  AlertCircle,
  FileText,
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
        <Skeleton className="h-48 rounded-2xl sm:h-44" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Veille"
          title="Dashboard"
          description="Supervision du bot X AI Weekly"
        />
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

      <section
        aria-labelledby="dashboard-title"
        className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-500"
      >
        <div className="pointer-events-none absolute inset-0 bg-brand-aurora" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-grid-fade" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs font-medium text-primary dark:border-primary/30 dark:bg-primary/15">
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              {running
                ? 'Run en cours…'
                : nextRunLabel
                  ? `Veille active · prochain run dans ${nextRunLabel}`
                  : 'Veille active'}
            </span>
            <h1
              id="dashboard-title"
              className="text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Votre veille,{' '}
              <span className="text-gradient-brand">en pilote automatique</span>
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Collecte automatique des sources, synthèse IA chaque matin. Tout
              se pilote d'ici, d'un coup d'œil.
            </p>
          </div>
          <ConfirmDialog
            trigger={
              <Button
                size="lg"
                disabled={running || triggering}
                aria-label="Lancer un run maintenant"
                className="hidden shrink-0 gap-2 shadow-lg shadow-primary/25 sm:inline-flex"
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
        </div>
      </section>

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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-backwards">
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
        <Card className="hover:border-muted-foreground/20 hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-backwards">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Dernier run · #{lastRun.id}
                </p>
                <CardTitle className="text-base">{lastRun.started_at}</CardTitle>
                <CardDescription>
                  {lastRun.tweets_fetched} message{lastRun.tweets_fetched !== 1 ? 's' : ''} collecté{lastRun.tweets_fetched !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              <StatusBadge status={lastRun.status} />
            </div>
          </CardHeader>

          {lastRun.summary && (
            <CardContent className="pt-0 space-y-2">
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Synthèse de la veille
                  </p>
                </div>
                <MarkdownContent content={lastRun.summary} className="text-sm" />
              </div>
            </CardContent>
          )}

          {lastRun.error_message && (
            <CardContent className="pt-0">
              <details className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <summary className="cursor-pointer font-medium text-destructive text-sm select-none">
                  Détail de l'erreur
                </summary>
                <pre className="mt-3 rounded-lg bg-background p-3 text-xs overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {lastRun.error_message}
                </pre>
              </details>
            </CardContent>
          )}

          <CardFooter className="border-t gap-1 py-3">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <Link to="/summaries">
                Toutes les synthèses
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <Link to="/runs">
                Historique complet
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card className="relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-backwards">
          <div className="pointer-events-none absolute inset-0 bg-brand-aurora" aria-hidden="true" />
          <CardContent className="relative py-16 flex flex-col items-center gap-4 text-center">
            <div
              className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-chart-2/15 text-primary ring-1 ring-inset ring-primary/15"
              aria-hidden="true"
            >
              <Activity className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Aucun run enregistré</p>
              <p className="text-sm text-muted-foreground">
                Lancez un premier run pour voir apparaître ici votre synthèse IA.
              </p>
            </div>
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
