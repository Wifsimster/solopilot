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
  Flame,
} from 'lucide-react';
import { humanizeCron, nextCronDate, formatTimeUntil } from '@/lib/utils';
import { ConfirmDialog } from '@/components/responsive-dialog';
import { MarkdownContent } from '@/components/markdown-content';
import { toast } from 'sonner';
import { useSelectedProduct, withProductId } from '@/lib/product-context-hooks';
import type { StatusResponse, VeilleItem } from '@/types';
import { Badge } from '@/components/ui/badge';
import { URGENT_THRESHOLD } from '@/pages/mentions';

const POLL_INTERVAL_MS = 4_000;
const URGENT_FETCH_LIMIT = 50;
const URGENT_PREVIEW_COUNT = 3;

/**
 * "À traiter" widget: urgent, still-untriaged mentions surfaced on the
 * dashboard so critical signals don't wait for a visit to the Mentions page.
 * Renders nothing when there is nothing urgent (or triage is not enabled).
 */
function UrgentMentionsCard({ productId }: { productId: string }) {
  const { data: items } = useApi<VeilleItem[]>(
    `/api/veille/items?status=new&minUrgency=${URGENT_THRESHOLD}&sort=urgency&limit=${URGENT_FETCH_LIMIT}`,
    { productId },
  );
  if (!items || items.length === 0) return null;

  const countLabel = items.length >= URGENT_FETCH_LIMIT ? `${URGENT_FETCH_LIMIT}+` : `${items.length}`;

  return (
    <Alert role="status" className="border-destructive/40 bg-destructive/5">
      <Flame className="size-4 text-destructive" />
      <AlertTitle className="flex items-center gap-2">
        Mentions urgentes à traiter
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 tabular-nums">
          {countLabel}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 space-y-1">
          {items.slice(0, URGENT_PREVIEW_COUNT).map((item) => (
            <li key={item.id} className="truncate text-sm">
              <span className="tabular-nums font-medium">{item.triage_urgency}/100</span>
              {' — '}
              {item.text}
            </li>
          ))}
        </ul>
        <Link to="/mentions" className="mt-2 inline-flex items-center gap-1 font-medium underline">
          Ouvrir la boîte des mentions
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </AlertDescription>
    </Alert>
  );
}

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
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-5 w-64" />
        </div>
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

      <PageHeader
        eyebrow="Veille"
        title="Dashboard"
        description="Supervision du bot X AI Weekly"
        actions={
          <ConfirmDialog
            trigger={
              <Button
                disabled={running || triggering}
                aria-label="Lancer un run maintenant"
                className="hidden sm:inline-flex gap-2"
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

      <UrgentMentionsCard productId={selectedProductId} />

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
        <Card className="hover:border-muted-foreground/20 transition-colors">
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
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
              <Activity className="size-5 text-muted-foreground" />
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
