import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { FileText, TrendingUp, Clock, AlertCircle } from 'lucide-react';
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
import { DataTable } from '@/components/ui/data-table';
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
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' }
> = {
  paid: { label: 'Payée', variant: 'success' },
  sent: { label: 'Envoyée', variant: 'warning' },
  draft: { label: 'Brouillon', variant: 'outline' },
  void: { label: 'Annulée', variant: 'destructive' },
};

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const revenueConfig = {
  revenue: { label: 'CA encaissé', color: 'var(--chart-1)' },
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
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">{row.original.number}</span>
    ),
  },
  { accessorKey: 'client_name', header: 'Client' },
  {
    accessorKey: 'issued_on',
    header: 'Émise',
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">{row.original.issued_on}</span>
    ),
  },
  {
    accessorKey: 'due_on',
    header: 'Échéance',
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">{row.original.due_on}</span>
    ),
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

  const list = useMemo(() => invoices.data ?? [], [invoices.data]);
  const revenue = useMemo(() => monthlyRevenue(list), [list]);
  const drafts = relances.data ?? [];

  // Derived KPIs
  const totalPaid = useMemo(
    () => list.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0),
    [list],
  );
  const totalPending = useMemo(
    () => list.filter((i) => i.status === 'sent').reduce((s, i) => s + i.amount_cents, 0),
    [list],
  );
  const overdueCount = drafts.length;
  const currency = list[0]?.currency ?? 'EUR';

  if (invoices.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Facturation" description="Factures et relances" />
        <ErrorState message={invoices.error} context="facturation" onRetry={invoices.refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Facturation"
        title="Factures & relances"
        description="Ledger local de vos factures. Les relances sont préparées mais jamais envoyées sans votre validation."
      />

      {/* KPI row */}
      {invoices.loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="CA encaissé" icon={TrendingUp} tone="success">
            <span className="tabular-nums">{amount(totalPaid, currency)}</span>
          </StatCard>
          <StatCard title="En attente" icon={Clock} tone="warning">
            <span className="tabular-nums">{amount(totalPending, currency)}</span>
          </StatCard>
          <StatCard
            title="Relances à valider"
            icon={AlertCircle}
            tone={overdueCount > 0 ? 'destructive' : 'default'}
          >
            {overdueCount}
          </StatCard>
        </div>
      )}

      {/* Relance drafts */}
      {drafts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Relances à valider</CardTitle>
                <CardDescription>
                  Ces relances ont été rédigées automatiquement — relisez avant d'envoyer.
                </CardDescription>
              </div>
              <Badge variant="destructive" className="shrink-0 tabular-nums">
                {drafts.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {drafts.map((d) => (
              <div
                key={d.invoiceNumber}
                className="rounded-lg border border-border bg-muted/40 p-3.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">{d.invoiceNumber}</span>
                  <span className="text-muted-foreground" aria-hidden="true">·</span>
                  <span className="text-muted-foreground">{d.clientName}</span>
                  <Badge variant="destructive" className="ml-auto shrink-0 text-xs tabular-nums">
                    {d.daysOverdue} j de retard
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                  {d.body}
                </p>
              </div>
            ))}
          </CardContent>
          <CardFooter className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Les relances sont préparées mais jamais envoyées sans votre validation.
            </p>
          </CardFooter>
        </Card>
      )}

      {/* Revenue chart */}
      {revenue.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>CA encaissé par mois</CardTitle>
            <CardDescription>Cumul des factures payées sur les 6 derniers mois</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={revenueConfig} className="h-64 w-full sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart accessibilityLayer data={revenue} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${Number(v).toLocaleString('fr-FR')} €`}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    width={72}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        formatter={(v) => `${Number(v).toLocaleString('fr-FR')} €`}
                      />
                    }
                  />
                  <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Invoice table */}
      {invoices.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileText className="size-5 text-muted-foreground" />
            </div>
            <p className="font-medium">Aucune facture</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Le module fonctionne en ledger local ; la synchronisation Stripe est optionnelle.
            </p>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
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
          emptyMessage="Aucune facture correspondant aux filtres."
        />
      )}
    </div>
  );
}
