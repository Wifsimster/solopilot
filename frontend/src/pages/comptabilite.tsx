import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { useSelectedProduct } from '@/lib/product-context-hooks';

interface ComptaStatus {
  year: number;
  activityType: 'services_bnc' | 'services_bic' | 'vente';
  caCents: number;
  plafondCents: number;
  plafondPct: number;
  tvaThresholdCents: number;
  tvaPct: number;
  approachingPlafond: boolean;
  tvaExceeded: boolean;
}

interface Urssaf {
  periodLabel: string;
  caCents: number;
  cotisationsRateBps: number;
  cotisationsCents: number;
}

interface ComptaResponse {
  status: ComptaStatus;
  urssaf: Urssaf;
  config: { activityType: string; declarationPeriod: string };
}

const euros = (cents: number) => `${(cents / 100).toFixed(2)} €`;

function Gauge({ label, value, pct, exceeded }: { label: string; value: string; pct: number; exceeded?: boolean }) {
  const clamped = Math.min(pct, 100);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between text-base font-semibold">
          {label}
          <Badge variant={exceeded ? 'destructive' : pct >= 80 ? 'secondary' : 'outline'} className="text-xs">
            {pct}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className={`h-2 rounded-full ${exceeded ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary'}`}
            style={{ width: `${clamped}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function ComptabilitePage() {
  const { selectedProductId } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<ComptaResponse>('/api/comptabilite', {
    productId: selectedProductId,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Comptabilité" description="CA, plafonds et URSSAF" />
        <ErrorState message={error} context="comptabilité" onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comptabilité & URSSAF"
        description="Suivi du chiffre d'affaires, plafonds micro-entreprise et estimations URSSAF. Estimations indicatives — Solopilot prépare et rappelle, ne télédéclare pas."
      />

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Gauge
            label={`Plafond micro ${data.status.year}`}
            value={`${euros(data.status.caCents)} / ${euros(data.status.plafondCents)}`}
            pct={data.status.plafondPct}
            exceeded={data.status.plafondPct >= 100}
          />
          <Gauge
            label="Franchise TVA"
            value={`${euros(data.status.caCents)} / ${euros(data.status.tvaThresholdCents)}`}
            pct={data.status.tvaPct}
            exceeded={data.status.tvaExceeded}
          />

          <Card className="sm:col-span-2">
            <CardHeader className="pb-2">
              <div className="text-base font-semibold">Prochaine déclaration URSSAF</div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Période : </span>
                {data.urssaf.periodLabel} ({data.config.declarationPeriod === 'quarterly' ? 'trimestriel' : 'mensuel'})
              </div>
              <div>
                <span className="text-muted-foreground">CA à déclarer : </span>
                <span className="font-semibold">{euros(data.urssaf.caCents)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cotisations estimées ({(data.urssaf.cotisationsRateBps / 100).toFixed(1)}%) : </span>
                <span className="font-semibold">{euros(data.urssaf.cotisationsCents)}</span>
              </div>
              <div className="pt-2 text-xs text-muted-foreground">
                Estimation. Télédéclaration sur autoentrepreneur.urssaf.fr.
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
