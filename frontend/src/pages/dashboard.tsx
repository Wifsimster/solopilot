import { useState, useEffect, useRef, useCallback } from 'react';
import { useApi } from '@/hooks/use-api';
import { StatusBadge } from '@/components/status-badge';
import { StatCard } from '@/components/stat-card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Activity, Clock, Zap, AlertCircle, Timer } from 'lucide-react';
import { humanizeCron, nextCronDate, formatTimeUntil } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { MarkdownContent } from '@/components/markdown-content';
import { toast } from 'sonner';
import { useSelectedProduct, withProductId } from '@/lib/product-context';
import type { StatusResponse } from '@/types';

const POLL_INTERVAL_MS = 4_000;

export function DashboardPage() {
  const { selectedProductId } = useSelectedProduct();
  const { data: status, loading, error, refetch } = useApi<StatusResponse>('/api/status', {
    productId: selectedProductId,
  });
  const [triggering, setTriggering] = useState(false);
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

  // Auto-poll while a run or collection is active
  useEffect(() => {
    const isActive = status?.running || status?.collecting;
    if (isActive && !pollRef.current) {
      startPolling();
      wasRunning.current = true;
    } else if (!isActive && wasRunning.current) {
      stopPolling();
      wasRunning.current = false;
      // One final refetch to get the completed state
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
        // Start polling immediately after triggering
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Supervision du bot X AI Weekly</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Impossible de charger le statut : {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!status) return null;

  const { lastRun, cronSchedule, running, totalRuns } = status;
  const nextRun = nextCronDate(cronSchedule);
  const nextRunLabel = nextRun ? formatTimeUntil(nextRun) : null;
  const cookiesExpired =
    lastRun?.error_message?.includes('401') ||
    lastRun?.error_message?.includes('403') ||
    lastRun?.error_message?.includes('404') ||
    lastRun?.error_message?.includes('Session cookies') ||
    false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Supervision du bot X AI Weekly</p>
      </div>

      {cookiesExpired && (
        <Alert variant="destructive">
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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
        <StatCard title="Total runs" icon={Activity}>
          {totalRuns}
        </StatCard>
        <StatCard title="Planification" icon={Clock}>
          <span className="text-base">{humanizeCron(cronSchedule)}</span>
        </StatCard>
        <StatCard title="Prochain run" icon={Timer}>
          {running ? (
            <StatusBadge status="running" />
          ) : nextRunLabel ? (
            <span className="text-base">dans {nextRunLabel}</span>
          ) : (
            <span className="text-muted-foreground text-base">—</span>
          )}
        </StatCard>
        <StatCard title="Statut actuel" icon={Zap}>
          {running ? (
            <StatusBadge status="running" />
          ) : (
            <span className="text-muted-foreground text-base">Inactif</span>
          )}
        </StatCard>
      </div>

      {lastRun && (
        <Card>
          <CardHeader>
            <div className="font-semibold">Dernier run</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Statut</p>
                <StatusBadge status={lastRun.status} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium">{lastRun.started_at}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Messages collectés</p>
                <p className="font-medium">{lastRun.tweets_fetched}</p>
              </div>
            </div>

            {lastRun.summary && (
              <div className="rounded-lg border border-l-4 border-l-primary/30 p-4">
                <p className="font-semibold mb-2">Synthèse de la veille</p>
                <MarkdownContent content={lastRun.summary} className="text-sm" />
              </div>
            )}

            {lastRun.error_message && (
              <details open>
                <summary className="cursor-pointer font-medium text-destructive">Erreur</summary>
                <pre className="mt-2 rounded-lg bg-muted p-4 text-xs overflow-x-auto max-h-96">
                  {lastRun.error_message}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {!lastRun && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun run enregistré.
          </CardContent>
        </Card>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={running || triggering} className="w-full sm:w-auto">
            {running || triggering ? 'Run en cours...' : 'Lancer un run maintenant'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lancer un run maintenant ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action va déclencher un scraping de votre timeline X et générer un résumé IA des
              actualités.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleTrigger}>Lancer le run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
