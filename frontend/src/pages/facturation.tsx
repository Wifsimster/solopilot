import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
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

function statusBadge(status: Invoice['status']) {
  const map: Record<Invoice['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    paid: { label: 'Payée', variant: 'default' },
    sent: { label: 'Envoyée', variant: 'secondary' },
    draft: { label: 'Brouillon', variant: 'outline' },
    void: { label: 'Annulée', variant: 'destructive' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

export function FacturationPage() {
  const { selectedProduct } = useSelectedProduct();
  const invoices = useApi<Invoice[]>('/api/facturation/invoices', { productId: selectedProduct });
  const relances = useApi<Relance[]>('/api/facturation/relances', { productId: selectedProduct });

  if (invoices.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Facturation" description="Factures et relances" />
        <ErrorState message={invoices.error} context="facturation" onRetry={invoices.refetch} />
      </div>
    );
  }

  const list = invoices.data ?? [];
  const drafts = relances.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description="Ledger local de vos factures. Les relances sont préparées mais jamais envoyées sans votre validation."
      />

      {drafts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between text-base font-semibold">
              Relances à valider
              <Badge variant="destructive" className="text-xs">{drafts.length}</Badge>
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

      {invoices.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Aucune facture. Le module fonctionne en ledger local ; la synchronisation Stripe est
            optionnelle.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {inv.number} · {inv.client_name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Émise le {inv.issued_on} · échéance {inv.due_on}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold tabular-nums">
                    {amount(inv.amount_cents, inv.currency)}
                  </span>
                  {statusBadge(inv.status)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
