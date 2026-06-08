import { useApi } from '@/hooks/use-api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { MarkdownContent } from '@/components/markdown-content';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import {
  Eye,
  TrendingUp,
  Receipt,
  Calculator,
  Users,
  CalendarDays,
  Workflow,
  AlertTriangle,
} from 'lucide-react';

type ModuleStatus = 'live' | 'planned';

interface Briefing {
  activityId: string;
  date: string;
  generatedAt: string;
  veille: {
    status: ModuleStatus;
    lastDigestAt: string | null;
    lastDigestStatus: string | null;
    summary: string | null;
    pendingItems: number;
  };
  acquisition: { status: ModuleStatus; newLeads: number };
  facturation: {
    status: ModuleStatus;
    unpaid: number;
    overdue: number;
    overdueAmountCents: number;
  };
  compta: {
    status: ModuleStatus;
    caCents: number;
    plafondPct: number;
    approachingPlafond: boolean;
    tvaExceeded: boolean;
  };
  crm: {
    status: ModuleStatus;
    openDeals: number;
    staleDeals: number;
    openValueCents: number;
  };
  agenda: {
    status: ModuleStatus;
    todayCount: number;
    upcomingCount: number;
    nextTitle: string | null;
    nextStartsAt: string | null;
  };
  workflows: { total: number; byStatus: Record<string, number> };
}

function ModuleCardIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </div>
  );
}

function MetricValue({ value }: { value: React.ReactNode }) {
  return (
    <div className="text-3xl font-bold tabular-nums tracking-tight leading-none">{value}</div>
  );
}

export function CockpitPage() {
  const { selectedProductId } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<Briefing>('/api/cockpit', {
    productId: selectedProductId,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Vue d'ensemble" title="Cockpit" description="Le brief du jour" />
        <ErrorState message={error} context="cockpit" onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Cockpit"
        description={
          data
            ? `Brief du ${data.date} — la photo du jour de votre activité`
            : 'Le brief du jour'
        }
      />

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="sm:col-span-2 h-40 w-full rounded-xl" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Veille — full width */}
          <Card className="sm:col-span-2 hover:border-muted-foreground/20 transition-colors">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ModuleCardIcon icon={Eye} />
                  <div className="space-y-0.5">
                    <CardTitle>Veille</CardTitle>
                    {data.veille.lastDigestAt && (
                      <CardDescription>
                        Dernier digest : {formatDateFr(data.veille.lastDigestAt)}
                      </CardDescription>
                    )}
                  </div>
                </div>
                {data.veille.pendingItems > 0 && (
                  <Badge variant="warning">{data.veille.pendingItems} en attente</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {data.veille.summary ? (
                <MarkdownContent content={data.veille.summary} className="text-sm" />
              ) : (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                    <Eye className="size-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">Pas encore de digest disponible.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Acquisition */}
          <Card className="hover:border-muted-foreground/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ModuleCardIcon icon={TrendingUp} />
                  <CardTitle>Acquisition</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <MetricValue value={data.acquisition.newLeads} />
              <p className="mt-1.5 text-sm text-muted-foreground">
                nouveau(x) signal(aux) d'intérêt à traiter
              </p>
            </CardContent>
          </Card>

          {/* Workflows */}
          <Card className="hover:border-muted-foreground/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <ModuleCardIcon icon={Workflow} />
                <CardTitle>Workflows</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <MetricValue value={data.workflows.total} />
              {Object.entries(data.workflows.byStatus).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(data.workflows.byStatus).map(([status, count]) => (
                    <Badge key={status} variant="outline" className="text-xs tabular-nums">
                      {status}: {count}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">exécutions récentes</p>
              )}
            </CardContent>
          </Card>

          {/* Facturation */}
          <Card className="hover:border-muted-foreground/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ModuleCardIcon icon={Receipt} />
                  <CardTitle>Facturation</CardTitle>
                </div>
                {data.facturation.unpaid > 0 && (
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {data.facturation.unpaid} en attente
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <MetricValue value={data.facturation.overdue} />
              <p className="mt-1.5 text-sm text-muted-foreground">
                facture(s) en retard
                {data.facturation.overdueAmountCents > 0 && (
                  <span className="tabular-nums">
                    {` — ${(data.facturation.overdueAmountCents / 100).toFixed(2)} €`}
                  </span>
                )}
              </p>
            </CardContent>
          </Card>

          {/* Comptabilité */}
          <Card className="hover:border-muted-foreground/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ModuleCardIcon icon={Calculator} />
                  <CardTitle>Comptabilité</CardTitle>
                </div>
                {(data.compta.approachingPlafond || data.compta.tvaExceeded) && (
                  <Badge variant="destructive" className="text-xs gap-1 shrink-0">
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    {data.compta.tvaExceeded ? 'Seuil TVA dépassé' : 'Plafond proche'}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <MetricValue value={`${data.compta.plafondPct}%`} />
              <p className="mt-1.5 text-sm text-muted-foreground">
                du plafond micro —{' '}
                <span className="tabular-nums">{(data.compta.caCents / 100).toFixed(2)} €</span>{' '}
                CA
              </p>
            </CardContent>
          </Card>

          {/* CRM */}
          <Card className="hover:border-muted-foreground/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ModuleCardIcon icon={Users} />
                  <CardTitle>CRM</CardTitle>
                </div>
                {data.crm.staleDeals > 0 && (
                  <Badge variant="warning" className="text-xs tabular-nums shrink-0">
                    {data.crm.staleDeals} à relancer
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <MetricValue value={data.crm.openDeals} />
              <p className="mt-1.5 text-sm text-muted-foreground">
                opportunité(s) ouverte(s)
                {data.crm.openValueCents > 0 && (
                  <span className="tabular-nums">
                    {` — ${(data.crm.openValueCents / 100).toFixed(0)} €`}
                  </span>
                )}
              </p>
            </CardContent>
          </Card>

          {/* Agenda */}
          <Card className="hover:border-muted-foreground/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <ModuleCardIcon icon={CalendarDays} />
                <CardTitle>Agenda</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <MetricValue value={data.agenda.todayCount} />
              <p className="mt-1.5 text-sm text-muted-foreground">
                événement(s) aujourd'hui
                {data.agenda.nextTitle && data.agenda.todayCount === 0 && (
                  <> — prochain : {data.agenda.nextTitle}</>
                )}
              </p>
            </CardContent>
          </Card>

          {/* Placeholder for grid balance on odd module count */}
          <div className="hidden sm:block" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
