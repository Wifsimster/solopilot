import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { DealPipeline, type Deal, type Stage } from '@/components/deal-pipeline';
import { useSelectedProduct, withProductId } from '@/lib/product-context-hooks';

interface Contact {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  status: string;
}

export function CrmPage() {
  const { selectedProductId } = useSelectedProduct();
  const contacts = useApi<Contact[]>('/api/crm/contacts', { productId: selectedProductId });
  const deals = useApi<Deal[]>('/api/crm/deals', { productId: selectedProductId });

  // Local copy so the pipeline can move cards optimistically before the API confirms.
  const [board, setBoard] = useState<Deal[]>([]);
  useEffect(() => {
    if (deals.data) setBoard(deals.data);
  }, [deals.data]);

  const contactName = (id: string) => contacts.data?.find((c) => c.id === id)?.name ?? 'Contact';

  async function moveDeal(dealId: string, stage: Stage) {
    const previous = board;
    setBoard((b) => b.map((d) => (d.id === dealId ? { ...d, stage } : d)));
    try {
      const res = await fetch(withProductId(`/api/crm/deals/${dealId}/stage`, selectedProductId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
    } catch {
      setBoard(previous);
      toast.error("Impossible de déplacer l'opportunité.");
    }
  }

  if (contacts.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="CRM" description="Contacts et opportunités" />
        <ErrorState message={contacts.error} context="crm" onRetry={contacts.refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        description="Glissez une opportunité d'une colonne à l'autre pour la faire avancer. Les relances des affaires dormantes sont préparées pour validation."
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline
        </h2>
        {deals.loading ? (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <DealPipeline deals={board} contactName={contactName} onMove={moveDeal} />
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Contacts
        </h2>
        {contacts.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (contacts.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Aucun contact. Les leads de l'Acquisition pourront être promus ici.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(contacts.data ?? []).map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[c.company, c.email].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {c.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
