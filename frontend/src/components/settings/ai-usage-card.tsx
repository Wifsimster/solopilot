import { useApi } from '@/hooks/use-api';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AiUsageResponse } from '@/types';

const PROVIDER_LABELS: Record<AiUsageResponse['provider'], string> = {
  anthropic: 'Anthropic',
  'github-models': 'GitHub Models (compatible OpenAI)',
};

function usd(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'USD' });
}

function tokens(value: number): string {
  return value.toLocaleString('fr-FR');
}

/** Read-only: provider, models and month-to-date spend vs AI_MONTHLY_BUDGET_USD. */
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

        {data.byTask.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tâche</TableHead>
                <TableHead className="text-right">Appels</TableHead>
                <TableHead className="text-right">Tokens entrée</TableHead>
                <TableHead className="text-right">Tokens cache lus</TableHead>
                <TableHead className="text-right">Tokens sortie</TableHead>
                <TableHead className="text-right">Coût estimé</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byTask.map((row) => (
                <TableRow key={row.task}>
                  <TableCell className="font-mono text-xs">{row.task}</TableCell>
                  <TableCell className="text-right">{tokens(row.calls)}</TableCell>
                  <TableCell className="text-right">{tokens(row.input_tokens)}</TableCell>
                  <TableCell className="text-right">
                    {tokens(row.cache_read_input_tokens)}
                  </TableCell>
                  <TableCell className="text-right">{tokens(row.output_tokens)}</TableCell>
                  <TableCell className="text-right">{usd(row.cost_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
