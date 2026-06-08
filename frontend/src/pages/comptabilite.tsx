import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { TrendingUp, ShieldAlert, Receipt, ExternalLink } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { StatCard } from '@/components/stat-card';
import { useSelectedProduct } from '@/lib/product-context-hooks';

const repereConfig = { value: { label: 'Montant' } } satisfies ChartConfig;
const REPERE_COLORS = ['var(--chart-1)', 'var(--chart-4)', 'var(--chart-2)'];

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

function GaugeTone(pct: number, exceeded?: boolean): 'destructive' | 'warning' | 'success' {
  if (exceeded || pct >= 100) return 'destructive';
  if (pct >= 80) return 'warning';
  return 'success';
}

interface GaugeCardProps {
  label: string;
  description?: string;
  value: string;
  pct: number;
  exceeded?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

function GaugeCard({ label, description, value, pct, exceeded, icon: Icon }: GaugeCardProps) {
  const clamped = Math.min(pct, 100);
  const tone = GaugeTone(pct, exceeded);
  const barColor =
    tone === 'destructive'
      ? 'bg-destructive'
      : tone === 'warning'
        ? 'bg-warning'
        : 'bg-primary';
  const badgeVariant =
    tone === 'destructive'
      ? 'destructive'
      : tone === 'warning'
        ? 'warning'
        : ('success' as const);

  return (
    <Card className="group relative overflow-hidden transition-colors hover:border-muted-foreground/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Icon className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm">{label}</CardTitle>
              {description && (
                <CardDescription className="text-xs">{description}</CardDescription>
              )}
            </div>
          </div>
          <Badge variant={badgeVariant} className="shrink-0 tabular-nums">
            {pct}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${clamped}%` }}
            role="progressbar"
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={100}
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
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Comptabilité"
        title="Comptabilité & URSSAF"
        description="Suivi du chiffre d'affaires, plafonds micro-entreprise et estimations URSSAF. Estimations indicatives — Solopilot prépare et rappelle, ne télédéclare pas."
      />

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* KPI: CA total */}
          <StatCard title={`Chiffre d'affaires ${data.status.year}`} icon={TrendingUp} tone="default">
            <span className="tabular-nums">{euros(data.status.caCents)}</span>
          </StatCard>

          {/* KPI: cotisations */}
          <StatCard title="Cotisations estimées" icon={Receipt} tone="default">
            <span className="tabular-nums">{euros(data.urssaf.cotisationsCents)}</span>
          </StatCard>

          {/* Plafond gauge */}
          <GaugeCard
            label={`Plafond micro ${data.status.year}`}
            description={`sur ${euros(data.status.plafondCents)}`}
            value={euros(data.status.caCents)}
            pct={data.status.plafondPct}
            exceeded={data.status.plafondPct >= 100}
            icon={ShieldAlert}
          />

          {/* TVA gauge */}
          <GaugeCard
            label="Franchise TVA"
            description={`seuil ${euros(data.status.tvaThresholdCents)}`}
            value={euros(data.status.caCents)}
            pct={data.status.tvaPct}
            exceeded={data.status.tvaExceeded}
            icon={ShieldAlert}
          />

          {/* URSSAF declaration */}
          <Card className="sm:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle>Prochaine déclaration URSSAF</CardTitle>
              <CardDescription>
                {data.urssaf.periodLabel} —{' '}
                {data.config.declarationPeriod === 'quarterly' ? 'trimestrielle' : 'mensuelle'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    CA à déclarer
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                    {euros(data.urssaf.caCents)}
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Cotisations ({(data.urssaf.cotisationsRateBps / 100).toFixed(1)}%)
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                    {euros(data.urssaf.cotisationsCents)}
                  </dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter className="border-t border-border pt-4">
              <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Estimation indicative. Télédéclaration sur{' '}
                <a
                  href="https://www.autoentrepreneur.urssaf.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  autoentrepreneur.urssaf.fr
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
                .
              </p>
            </CardFooter>
          </Card>

          {/* Repères chart */}
          <Card className="sm:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle>Repères annuels</CardTitle>
              <CardDescription>
                CA encaissé comparé aux seuils TVA et plafond micro
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={repereConfig} className="h-64 w-full sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    accessibilityLayer
                    layout="vertical"
                    data={[
                      { name: 'CA encaissé', value: Math.round(data.status.caCents / 100) },
                      { name: 'Seuil TVA', value: Math.round(data.status.tvaThresholdCents / 100) },
                      { name: 'Plafond micro', value: Math.round(data.status.plafondCents / 100) },
                    ]}
                    margin={{ top: 4, left: 4, right: 16, bottom: 4 }}
                  >
                    <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)} k€`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={100}
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          formatter={(v) => `${Number(v).toLocaleString('fr-FR')} €`}
                        />
                      }
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {REPERE_COLORS.map((color, i) => (
                        <Cell key={i} fill={color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
