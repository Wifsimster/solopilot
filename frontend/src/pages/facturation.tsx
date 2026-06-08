import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ui/data-table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { useSelectedProduct, withProductId } from '@/lib/product-context-hooks';

interface Invoice {
  id: string;
  number: string;
  client_name: string;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  issued_on: string;
  due_on: string;
}

interface Relance {
  invoiceNumber: string;
  clientName: string;
  daysOverdue: number;
  subject: string;
  body: string;
}

function amount(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

const STATUS_META: Record<
  Invoice['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  paid: { label: 'Payée', variant: 'default' },
  sent: { label: 'Envoyée', variant: 'secondary' },
  draft: { label: 'Brouillon', variant: 'outline' },
  void: { label: 'Annulée', variant: 'destructive' },
};

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const revenueConfig = {
  revenue: { label: 'CA encaissé', color: 'var(--chart-2)' },
} satisfies ChartConfig;

/** Sum paid invoices by calendar month (last 6 months that have data). */
function monthlyRevenue(invoices: Invoice[]): { month: string; revenue: number }[] {
  const byMonth = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== 'paid') continue;
    const m = /^(\d{4})-(\d{2})/.exec(inv.issued_on);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + inv.amount_cents);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, cents]) => ({
      month: `${MONTHS_FR[Number(key.slice(5, 7)) - 1]}`,
      revenue: Math.round(cents / 100),
    }));
}

const columns: ColumnDef<Invoice>[] = [
  {
    accessorKey: 'number',
    header: 'Facture',
    cell: ({ row }) => <span className="font-medium">{row.original.number}</span>,
  },
  { accessorKey: 'client_name', header: 'Client' },
  {
    accessorKey: 'issued_on',
    header: 'Émise',
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.issued_on}</span>,
  },
  {
    accessorKey: 'due_on',
    header: 'Échéance',
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.due_on}</span>,
  },
  {
    accessorKey: 'amount_cents',
    header: 'Montant',
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">
        {amount(row.original.amount_cents, row.original.currency)}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Statut',
    cell: ({ row }) => {
      const { label, variant } = STATUS_META[row.original.status];
      return (
        <Badge variant={variant} className="text-xs">
          {label}
        </Badge>
      );
    },
  },
];

export function FacturationPage() {
  const { selectedProductId } = useSelectedProduct();
  const invoices = useApi<Invoice[]>('/api/facturation/invoices', { productId: selectedProductId });
  const relances = useApi<Relance[]>('/api/facturation/relances', { productId: selectedProductId });
  const stripe = useApi<{ configured: boolean }>('/api/facturation/stripe', {
    productId: selectedProductId,
  });
  const [syncing, setSyncing] = useState(false);

  const list = useMemo(() => invoices.data ?? [], [invoices.data]);
  const revenue = useMemo(() => monthlyRevenue(list), [list]);
  const drafts = relances.data ?? [];

  const markPaid = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/facturation/invoices/${id}/paid`, { method: 'POST' });
        if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
        toast.success('Facture marquée payée.');
        invoices.refetch();
      } catch {
        toast.error('Impossible de marquer la facture payée.');
      }
    },
    [invoices],
  );

  const allColumns = useMemo<ColumnDef<Invoice>[]>(
    () => [
      ...columns,
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const inv = row.original;
          if (inv.status === 'paid' || inv.status === 'void') return null;
          return (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => markPaid(inv.id)}
            >
              Marquer payée
            </Button>
          );
        },
      },
    ],
    [markPaid],
  );

  async function syncStripe() {
    setSyncing(true);
    try {
      const res = await fetch(withProductId('/api/facturation/sync', selectedProductId), {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`);
      if (data.skipped) {
        toast.info('Stripe non configuré — rien à synchroniser.');
      } else {
        toast.success(`${data.synced} facture(s) synchronisée(s) depuis Stripe.`);
        invoices.refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de la synchronisation Stripe.');
    } finally {
      setSyncing(false);
    }
  }

  if (invoices.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Facturation" description="Factures et relances" />
        <ErrorState message={invoices.error} context="facturation" onRetry={invoices.refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description="Ledger local de vos factures. Les relances sont préparées mais jamais envoyées sans votre validation."
      />

      {stripe.data && (
        <div className="flex flex-wrap items-center gap-3">
          {stripe.data.configured ? (
            <>
              <Badge variant="success" className="text-xs">
                Stripe connecté
              </Badge>
              <Button size="sm" variant="outline" onClick={syncStripe} disabled={syncing}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Synchronisation…' : 'Synchroniser depuis Stripe'}
              </Button>
            </>
          ) : (
            <Badge variant="outline" className="text-xs">
              Mode ledger local — Stripe non configuré
            </Badge>
          )}
        </div>
      )}

      {drafts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between text-base font-semibold">
              Relances à valider
              <Badge variant="destructive" className="text-xs">
                {drafts.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {drafts.map((d) => (
              <div key={d.invoiceNumber} className="rounded-md border p-3 text-sm">
                <div className="font-medium">
                  {d.invoiceNumber} — {d.clientName}{' '}
                  <span className="text-muted-foreground">({d.daysOverdue} j de retard)</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{d.body}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {revenue.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="text-base font-semibold">CA encaissé par mois</div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={revenueConfig} className="aspect-[3/1] w-full">
              <BarChart accessibilityLayer data={revenue}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent formatter={(v) => `${Number(v).toLocaleString('fr-FR')} €`} />}
                />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {invoices.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={allColumns}
          data={list}
          initialSorting={[{ id: 'issued_on', desc: true }]}
          facetedFilters={[
            {
              columnId: 'status',
              title: 'Statut',
              options: (Object.keys(STATUS_META) as Invoice['status'][]).map((s) => ({
                label: STATUS_META[s].label,
                value: s,
              })),
            },
          ]}
          emptyMessage="Aucune facture. Le module fonctionne en ledger local ; la synchronisation Stripe est optionnelle."
        />
      )}
    </div>
  );
}
