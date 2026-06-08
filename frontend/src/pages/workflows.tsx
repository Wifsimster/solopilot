import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';

interface WorkflowTrigger {
  kind: 'cron' | 'manual' | 'event' | 'webhook';
  expr?: string;
  on?: string;
  path?: string;
}

interface WorkflowLastRun {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

interface WorkflowSummary {
  id: string;
  module: string;
  label: string;
  trigger: WorkflowTrigger;
  version: number;
  enabled: boolean;
  lastRun: WorkflowLastRun | null;
}

const MODULE_LABELS: Record<string, string> = {
  cockpit: 'Cockpit',
  veille: 'Veille',
  acquisition: 'Acquisition',
  crm: 'CRM',
  facturation: 'Facturation',
  compta: 'Comptabilité',
  agenda: 'Agenda',
};

function triggerLabel(trigger: WorkflowTrigger): string {
  switch (trigger.kind) {
    case 'cron':
      return `cron · ${trigger.expr}`;
    case 'event':
      return `événement · ${trigger.on}`;
    case 'webhook':
      return `webhook · ${trigger.path}`;
    default:
      return 'manuel';
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

function WorkflowRow({ wf }: { wf: WorkflowSummary }) {
  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium truncate">{wf.label}</div>
            <code className="text-xs text-muted-foreground">{wf.id}</code>
          </div>
          <Badge variant={wf.enabled ? 'default' : 'outline'} className="text-xs shrink-0">
            {wf.enabled ? 'Actif' : 'Désactivé'}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            {triggerLabel(wf.trigger)}
          </Badge>
          {wf.lastRun ? (
            <span className="flex items-center gap-1">
              Dernier run :
              <Badge variant={statusVariant(wf.lastRun.status)} className="text-xs">
                {wf.lastRun.status}
              </Badge>
              {formatDateFr(wf.lastRun.startedAt)}
            </span>
          ) : (
            <span>Aucun run</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkflowsPage() {
  const { selectedProduct } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<WorkflowSummary[]>('/api/workflows', {
    productId: selectedProduct,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workflows" description="Moteur de workflows Solopilot" />
        <ErrorState message={error} context="workflows" onRetry={refetch} />
      </div>
    );
  }

  const workflows = data ?? [];
  const modules = [...new Set(workflows.map((w) => w.module))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Processus métier orchestrés par le moteur. Lecture seule pendant la migration — les workflows sont enregistrés mais désactivés (ADR-0014)."
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Aucun workflow enregistré.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {modules.map((module) => (
            <section key={module} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {MODULE_LABELS[module] ?? module}
              </h2>
              <div className="space-y-2">
                {workflows
                  .filter((w) => w.module === module)
                  .map((wf) => (
                    <WorkflowRow key={wf.id} wf={wf} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
