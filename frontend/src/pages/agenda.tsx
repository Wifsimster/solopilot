import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { useSelectedProduct } from '@/lib/product-context-hooks';

interface CalendarEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  source: string;
}

interface AgendaResponse {
  summary: { todayCount: number; upcomingCount: number; nextTitle: string | null };
  today: CalendarEvent[];
  upcoming: CalendarEvent[];
}

function formatWhen(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const date = `${m[3]}/${m[2]}`;
  return m[4] ? `${date} ${m[4]}h${m[5]}` : date;
}

function EventRow({ e }: { e: CalendarEvent }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{e.title}</div>
          <div className="text-xs text-muted-foreground">
            {[formatWhen(e.starts_at), e.location].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Badge variant="outline" className="text-xs shrink-0">
          {e.source === 'ics' ? 'Calendrier' : 'Manuel'}
        </Badge>
      </CardContent>
    </Card>
  );
}

export function AgendaPage() {
  const { selectedProduct } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<AgendaResponse>('/api/agenda', {
    productId: selectedProduct,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agenda" description="Vos événements" />
        <ErrorState message={error} context="agenda" onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenda"
        description="Vos événements. Synchronisez un flux ICS (adresse secrète Google Calendar) ou ajoutez des événements manuellement."
      />

      {loading || !data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Aujourd'hui ({data.today.length})
            </h2>
            {data.today.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  Aucun événement aujourd'hui.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {data.today.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              À venir
            </h2>
            {data.upcoming.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  Aucun événement à venir. Configurez un flux ICS pour les importer.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {data.upcoming.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
