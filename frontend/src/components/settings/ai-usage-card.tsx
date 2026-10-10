import { useApi } from '@/hooks/use-api';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { AiUsageResponse } from '@/types';

const PROVIDER_LABELS: Record<AiUsageResponse['provider'], string> = {
  anthropic: 'Anthropic',
  'github-models': 'GitHub Models (compatible OpenAI)',
};

function usd(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'USD' });
}

/**
 * Compact summary: provider, models and month-to-date spend vs
 * AI_MONTHLY_BUDGET_USD. The full analysis lives on the « Dépenses IA » page.
 */
export function AiUsageCard() {
  const { data, loading, error } = useApi<AiUsageResponse>('/api/ai/usage');

  if (loading && !data) return <Skeleton className="h-40 rounded-xl" />;
  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Consommation IA indisponible : {error ?? 'réponse vide'}
        </AlertDescription>
      </Alert>
    );
  }

  const calls = data.byTask.reduce((sum, row) => sum + row.calls, 0);
  const topTask = data.byTask[0];
  const pct = Math.min(100, Math.round((data.spentUsd / data.budgetUsd) * 100));
  const barColor =
    data.level === 'exceeded'
      ? 'bg-destructive'
      : data.level === 'warning'
        ? 'bg-warning'
        : 'bg-primary';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Fournisseur IA et budget
          <Badge variant="secondary">{PROVIDER_LABELS[data.provider]}</Badge>
        </CardTitle>
        <CardDescription>
          Modèle principal <code className="font-mono text-xs">{data.model}</code>, tri et scoring{' '}
          <code className="font-mono text-xs">{data.fastModel}</code> (réglables ci-dessous).
          Variables d'environnement <code className="font-mono text-xs">AI_PROVIDER</code> et{' '}
          <code className="font-mono text-xs">AI_MONTHLY_BUDGET_USD</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.enforced ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span>
                Dépense estimée {data.month} : <strong>{usd(data.spentUsd)}</strong> /{' '}
                {usd(data.budgetUsd)}
              </span>
              <span className="text-muted-foreground">{pct} %</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Budget IA consommé"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            GitHub Models est gratuit : aucun budget appliqué. Les appels restent comptés
            ci-dessous.
          </p>
        )}

        {data.enforced && data.level === 'warning' && (
          <Alert variant="warning">
            <AlertDescription>
              Plus de 80 % du budget mensuel consommé. À 100 %, les tâches non essentielles (radar
              produit, résumé mensuel, studio, analyse des signaux) seront suspendues.
            </AlertDescription>
          </Alert>
        )}
        {data.enforced && data.level === 'exceeded' && (
          <Alert variant="destructive">
            <AlertDescription>
              Budget mensuel atteint : seuls le digest de veille et le tri des mentions tournent
              jusqu'au 1er du mois.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {calls.toLocaleString('fr-FR')} appel{calls > 1 ? 's' : ''} ce mois-ci
            {topTask ? `, surtout « ${topTask.task} »` : ''}.
          </span>
          <Link
            to="/depenses-ia"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            Analyse détaillée des dépenses
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
