import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import { Workflow, Clock, CheckCircle2, XCircle, Circle } from 'lucide-react';

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

function statusVariant(status: string): 'success' | 'destructive' | 'secondary' {
  if (status === 'success') return 'success';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

function LastRunIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />;
  if (status === 'error') return <XCircle className="size-3.5 text-destructive" aria-hidden="true" />;
  return <Circle className="size-3.5 text-muted-foreground" aria-hidden="true" />;
}

function WorkflowRow({ wf }: { wf: WorkflowSummary }) {
  return (
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm leading-none">{wf.label}</span>
              <Badge
                variant={wf.enabled ? 'brand' : 'outline'}
                className="text-xs shrink-0"
              >
                {wf.enabled ? 'Actif' : 'Désactivé'}
              </Badge>
            </div>
            <code className="text-xs text-muted-foreground block">{wf.id}</code>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs gap-1">
            <Clock className="size-3" aria-hidden="true" />
            {triggerLabel(wf.trigger)}
          </Badge>
          {wf.lastRun ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LastRunIcon status={wf.lastRun.status} />
              <Badge variant={statusVariant(wf.lastRun.status)} className="text-xs">
                {wf.lastRun.status}
              </Badge>
              <span>{formatDateFr(wf.lastRun.startedAt)}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Aucun run</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkflowsPage() {
  const { selectedProductId } = useSelectedProduct();
  const { data, loading, error, refetch } = useApi<WorkflowSummary[]>('/api/workflows', {
    productId: selectedProductId,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Moteur"
          title="Workflows"
          description="Moteur de workflows Solopilot"
        />
        <ErrorState message={error} context="workflows" onRetry={refetch} />
      </div>
    );
  }

  const workflows = data ?? [];
  const modules = [...new Set(workflows.map((w) => w.module))];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Moteur"
        title="Workflows"
        description="Processus métier orchestrés par le moteur. Lecture seule pendant la migration — les workflows sont enregistrés mais désactivés (ADR-0014)."
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
              <Workflow className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Aucun workflow enregistré</p>
              <p className="text-sm text-muted-foreground">
                Les workflows Solopilot apparaîtront ici une fois déployés.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {modules.map((module) => (
            <section key={module} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {MODULE_LABELS[module] ?? module}
                </h2>
                <div className="flex-1 h-px bg-border" aria-hidden="true" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {workflows.filter((w) => w.module === module).length}
                </span>
              </div>
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
