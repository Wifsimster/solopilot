import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { MarkdownContent } from '@/components/markdown-content';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';

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
  agenda: { status: ModuleStatus };
  workflows: { total: number; byStatus: Record<string, number> };
}

function PlannedCard({ title, hint }: { title: string; hint: string }) {
  return (
    <Card className="opacity-70">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between text-base font-semibold">
          {title}
          <Badge variant="outline" className="text-xs">
            À venir
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

export function CockpitPage() {
  const { selectedProduct } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<Briefing>('/api/cockpit', {
    productId: selectedProduct,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cockpit" description="Le brief du jour" />
        <ErrorState message={error} context="cockpit" onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cockpit"
        description={
          data
            ? `Brief du ${data.date} — la photo du jour de votre activité`
            : 'Le brief du jour'
        }
      />

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="sm:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between text-base font-semibold">
                Veille
                <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  {data.veille.pendingItems > 0 && (
                    <Badge variant="secondary">{data.veille.pendingItems} en attente</Badge>
                  )}
                  {data.veille.lastDigestAt && (
                    <span>Dernier digest : {formatDateFr(data.veille.lastDigestAt)}</span>
                  )}
                </span>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              {data.veille.summary ? (
                <MarkdownContent content={data.veille.summary} className="text-sm" />
              ) : (
                <span className="text-muted-foreground">Pas encore de digest disponible.</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="text-base font-semibold">Acquisition</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{data.acquisition.newLeads}</div>
              <div className="text-sm text-muted-foreground">
                nouveau(x) signal(aux) d'intérêt à traiter
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="text-base font-semibold">Workflows</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{data.workflows.total}</div>
              <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                {Object.entries(data.workflows.byStatus).length > 0
                  ? Object.entries(data.workflows.byStatus).map(([status, count]) => (
                      <Badge key={status} variant="outline">
                        {status}: {count}
                      </Badge>
                    ))
                  : 'exécutions récentes'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="text-base font-semibold">Facturation</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{data.facturation.overdue}</div>
              <div className="text-sm text-muted-foreground">
                facture(s) en retard
                {data.facturation.overdueAmountCents > 0 &&
                  ` — ${(data.facturation.overdueAmountCents / 100).toFixed(2)} €`}
              </div>
              {data.facturation.unpaid > 0 && (
                <Badge variant="outline" className="mt-2 text-xs">
                  {data.facturation.unpaid} en attente
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="text-base font-semibold">Comptabilité</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{data.compta.plafondPct}%</div>
              <div className="text-sm text-muted-foreground">
                du plafond micro — CA {(data.compta.caCents / 100).toFixed(2)} €
              </div>
              {(data.compta.approachingPlafond || data.compta.tvaExceeded) && (
                <Badge variant="destructive" className="mt-2 text-xs">
                  {data.compta.tvaExceeded ? 'Seuil TVA dépassé' : 'Plafond proche'}
                </Badge>
              )}
            </CardContent>
          </Card>

          <PlannedCard title="Agenda" hint="Synchronisation Google Calendar et rappels." />
        </div>
      )}
    </div>
  );
}
