import { useMemo } from 'react';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { AgendaCalendar, type SxEvent } from '@/components/agenda-calendar';
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

const pad = (n: number) => String(n).padStart(2, '0');

/** Convert our ISO event to Schedule-X's `YYYY-MM-DD[ HH:mm]` date strings. */
function toSx(e: CalendarEvent): SxEvent {
  const timed = /T\d{2}:\d{2}/.test(e.starts_at);
  const fmt = (iso: string) => iso.replace('T', ' ').slice(0, timed ? 16 : 10);
  const start = fmt(e.starts_at);
  let end = start;
  if (e.ends_at && /T\d{2}:\d{2}/.test(e.ends_at) === timed) {
    end = fmt(e.ends_at);
  } else if (timed) {
    const d = new Date(e.starts_at);
    d.setHours(d.getHours() + 1);
    end = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return { id: e.id, title: e.title, start, end };
}

export function AgendaPage() {
  const { selectedProductId } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<AgendaResponse>('/api/agenda', {
    productId: selectedProductId,
  });

  const events = useMemo<SxEvent[]>(() => {
    if (!data) return [];
    const byId = new Map<string, CalendarEvent>();
    for (const e of [...data.today, ...data.upcoming]) byId.set(e.id, e);
    return [...byId.values()].map(toSx);
  }, [data]);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

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
        <Skeleton className="h-[32rem] w-full" />
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Aucun événement. Configurez un flux ICS pour les importer ou ajoutez-en manuellement.
          </CardContent>
        </Card>
      ) : (
        // key on theme so Schedule-X (which reads isDark at creation) re-themes on toggle.
        <AgendaCalendar key={isDark ? 'dark' : 'light'} events={events} isDark={isDark} />
      )}
    </div>
  );
}
