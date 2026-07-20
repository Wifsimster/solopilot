import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import {
  Workflow,
  Clock,
  CheckCircle2,
  XCircle,
  Circle,
  Eye,
  TrendingUp,
  Receipt,
  Calculator,
  Users,
  CalendarDays,
  LayoutDashboard,
} from 'lucide-react';

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

type IconType = React.ComponentType<{ className?: string }>;

const MODULE_LABELS: Record<string, string> = {
  cockpit: 'Cockpit',
  veille: 'Veille',
  acquisition: 'Acquisition',
  crm: 'CRM',
  facturation: 'Facturation',
  compta: 'Comptabilité',
  agenda: 'Agenda',
};

const MODULE_ICONS: Record<string, IconType> = {
  cockpit: LayoutDashboard,
  veille: Eye,
  acquisition: TrendingUp,
  crm: Users,
  facturation: Receipt,
  compta: Calculator,
  agenda: CalendarDays,
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

function ModuleCardIcon({ icon: Icon, muted }: { icon: IconType; muted?: boolean }) {
  return (
    <div
      className={
        muted
          ? 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border'
          : 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground ring-1 ring-inset ring-accent-foreground/10'
      }
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </div>
  );
}

function WorkflowCard({ wf }: { wf: WorkflowSummary }) {
  const Icon = MODULE_ICONS[wf.module] ?? Workflow;
  return (
    <Card className="group flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/20 hover:shadow-md">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <ModuleCardIcon icon={Icon} muted={!wf.enabled} />
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate text-sm font-semibold leading-tight">{wf.label}</h3>
            <code className="block truncate text-xs text-muted-foreground">{wf.id}</code>
          </div>
          <Badge variant={wf.enabled ? 'brand' : 'outline'} className="shrink-0 text-xs">
            {wf.enabled ? 'Actif' : 'Désactivé'}
          </Badge>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Badge variant="outline" className="gap-1 font-mono text-xs">
            <Clock className="size-3" aria-hidden="true" />
            {triggerLabel(wf.trigger)}
          </Badge>
          {wf.lastRun ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LastRunIcon status={wf.lastRun.status} />
              <Badge variant={statusVariant(wf.lastRun.status)} className="text-xs">
                {wf.lastRun.status}
              </Badge>
              <span className="tabular-nums">{formatDateFr(wf.lastRun.startedAt)}</span>
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
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
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
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-backwards">
          {modules.map((module) => {
            const ModuleIcon = MODULE_ICONS[module] ?? Workflow;
            const moduleWorkflows = workflows.filter((w) => w.module === module);
            return (
              <section key={module} className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    <ModuleIcon className="size-3.5" />
                  </div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {MODULE_LABELS[module] ?? module}
                  </h2>
                  <div className="h-px flex-1 bg-border" aria-hidden="true" />
                  <Badge variant="secondary" className="tabular-nums">
                    {moduleWorkflows.length}
                  </Badge>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {moduleWorkflows.map((wf) => (
                    <WorkflowCard key={wf.id} wf={wf} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
