import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { useSelectedProduct } from '@/lib/product-context-hooks';

type Stage = 'nouveau' | 'qualifie' | 'proposition' | 'gagne' | 'perdu';

interface Contact {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  status: string;
}

interface Deal {
  id: string;
  contact_id: string;
  title: string;
  stage: Stage;
  amount_cents: number;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: 'nouveau', label: 'Nouveau' },
  { key: 'qualifie', label: 'Qualifié' },
  { key: 'proposition', label: 'Proposition' },
  { key: 'gagne', label: 'Gagné' },
  { key: 'perdu', label: 'Perdu' },
];

const euros = (cents: number) => `${(cents / 100).toFixed(0)} €`;

export function CrmPage() {
  const { selectedProduct } = useSelectedProduct();
  const contacts = useApi<Contact[]>('/api/crm/contacts', { productId: selectedProduct });
  const deals = useApi<Deal[]>('/api/crm/deals', { productId: selectedProduct });

  if (contacts.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="CRM" description="Contacts et opportunités" />
        <ErrorState message={contacts.error} context="crm" onRetry={contacts.refetch} />
      </div>
    );
  }

  const contactName = (id: string) =>
    contacts.data?.find((c) => c.id === id)?.name ?? 'Contact';
  const dealList = deals.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        description="Vos contacts et votre pipeline d'opportunités. Les relances des affaires dormantes sont préparées pour validation."
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
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {STAGES.map((stage) => {
              const inStage = dealList.filter((d) => d.stage === stage.key);
              const total = inStage.reduce((s, d) => s + d.amount_cents, 0);
              return (
                <Card key={stage.key}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      {stage.label}
                      <Badge variant="outline" className="text-xs">{inStage.length}</Badge>
                    </div>
                    {total > 0 && (
                      <div className="text-xs text-muted-foreground">{euros(total)}</div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {inStage.map((d) => (
                      <div key={d.id} className="rounded-md border p-2 text-xs">
                        <div className="font-medium">{d.title}</div>
                        <div className="text-muted-foreground">{contactName(d.contact_id)}</div>
                        {d.amount_cents > 0 && (
                          <div className="tabular-nums">{euros(d.amount_cents)}</div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
                  <Badge variant="outline" className="text-xs shrink-0">{c.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
