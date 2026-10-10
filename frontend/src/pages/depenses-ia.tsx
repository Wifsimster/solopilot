import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CircleCheck,
  Coins,
  Info,
  Lightbulb,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  CLASS_COLORS,
  CumulativeChart,
  ModelChart,
  SpendByClassChart,
  TokensChart,
} from '@/components/ai-spend/charts';
import { num, parisDateTime, pct, usd } from '@/components/ai-spend/format';
import type { AiBudgetLevel, AiSpendPeriod, AiSpendReport } from '@/types';

const PERIODS: { value: AiSpendPeriod; label: string }[] = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: 'month', label: 'Mois en cours' },
  { value: 'prev-month', label: 'Mois précédent' },
  { value: '12m', label: '12 mois' },
];

const LEVEL_META: Record<AiBudgetLevel, { label: string; icon: LucideIcon; text: string; bar: string }> = {
  ok: { label: 'Dans le budget', icon: CircleCheck, text: 'text-success', bar: 'bg-primary' },
  warning: { label: 'Seuil de 80 % atteint', icon: TriangleAlert, text: 'text-warning', bar: 'bg-warning' },
  exceeded: { label: 'Budget dépassé', icon: OctagonAlert, text: 'text-destructive', bar: 'bg-destructive' },
};

const TONE_META = {
  neutral: { icon: Info, label: 'Info', className: 'text-muted-foreground' },
  good: { icon: CircleCheck, label: 'Bon signe', className: 'text-success' },
  warning: { icon: TriangleAlert, label: 'Attention', className: 'text-warning' },
  critical: { icon: OctagonAlert, label: 'Alerte', className: 'text-destructive' },
} as const;

function PeriodPicker({ value, onChange }: { value: AiSpendPeriod; onChange: (p: AiSpendPeriod) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Période analysée"
      className="flex flex-wrap gap-1.5"
    >
      {PERIODS.map((p) => {
        const selected = p.value === value;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(p.value)}
            className={cn(
              'h-9 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'border-primary/40 bg-accent text-accent-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="truncate font-display text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      {children}
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Delta({ ratio, label }: { ratio: number | null; label: string }) {
  if (ratio === null) return <>Pas de dépense sur {label}</>;
  const p = Math.round(ratio * 100);
  const sign = p > 0 ? '+' : p < 0 ? '−' : '±';
  return (
    <>
      {sign}
      {Math.abs(p)}&nbsp;% vs {label}
    </>
  );
}

function KpiRow({ report }: { report: AiSpendReport }) {
  const m = report.month;
  const t = report.totals;
  const level = LEVEL_META[m.level];
  const LevelIcon = level.icon;
  const meterPct = Math.min(100, Math.round(m.budgetRatio * 100));
  return (
    <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label={`Dépense ${m.complete ? 'de' : 'du mois,'} ${m.label}`}
        value={usd(m.spentUsd)}
        detail={`${m.daysElapsed} / ${m.daysInMonth} jours`}
      />
      <Kpi
        label="Projection fin de mois"
        value={m.complete ? '—' : `≈ ${usd(m.projectedUsd)}`}
        detail={
          m.complete
            ? 'Mois terminé'
            : `Linéaire : ${usd(m.spentUsd)} ÷ ${m.daysElapsed} j × ${m.daysInMonth} j`
        }
      />
      <Kpi
        label={`Budget de ${m.label}`}
        value={report.enforced ? pct(m.budgetRatio) : 'Non appliqué'}
        detail={
          report.enforced ? (
            <span className={cn('inline-flex items-center gap-1 font-medium', level.text)}>
              <LevelIcon className="size-3.5" aria-hidden="true" />
              {level.label} · {usd(m.budgetUsd)}
            </span>
          ) : (
            'GitHub Models : gratuit'
          )
        }
      >
        {report.enforced && (
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
            role="progressbar"
            aria-label={`Budget de ${m.label} consommé`}
            aria-valuenow={meterPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${pct(m.budgetRatio)}, ${level.label}`}
          >
            <div className={cn('h-full rounded-full', level.bar)} style={{ width: `${meterPct}%` }} />
          </div>
        )}
      </Kpi>
      <Kpi
        label="Dépense sur la période"
        value={usd(t.costUsd)}
        detail={<Delta ratio={report.deltaRatio} label={report.previous.label} />}
      />
      <Kpi label="Coût moyen par jour" value={usd(t.avgCostPerDay)} detail={`Sur ${report.range.days} jours`} />
      <Kpi label="Appels" value={num(t.calls)} detail={`${num(report.previous.calls)} sur ${report.previous.label}`} />
      <Kpi
        label="Coût moyen par appel"
        value={t.avgCostPerCall === null ? '—' : usd(t.avgCostPerCall)}
      />
      <Kpi
        label="Taux de cache"
        value={pct(t.cacheRate)}
        detail={
          report.enforced && t.cacheRate !== null
            ? `~${usd(report.cacheSavingsUsd)} économisés (net)`
            : 'Tokens lus en cache / entrée'
        }
      />
    </section>
  );
}

function Insights({ report }: { report: AiSpendReport }) {
  if (report.insights.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-primary" aria-hidden="true" />
          Ce qu'il faut retenir
        </CardTitle>
        <CardDescription>Observations calculées à partir des données, sans appel IA.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {report.insights.map((i) => {
            const tone = TONE_META[i.tone];
            const Icon = tone.icon;
            return (
              <li key={i.id} className="flex gap-2.5 text-sm">
                <Icon className={cn('mt-0.5 size-4 shrink-0', tone.className)} aria-hidden="true" />
                <span>
                  <span className="sr-only">{tone.label} : </span>
                  {i.text}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function TaskTable({ report }: { report: AiSpendReport }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Détail par tâche</CardTitle>
        <CardDescription>{report.range.label}. Tokens = entrée + cache + sortie.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="tabular-nums">
          <TableHeader>
            <TableRow>
              <TableHead>Tâche</TableHead>
              <TableHead className="text-right">Appels</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Coût</TableHead>
              <TableHead className="text-right">Part</TableHead>
              <TableHead className="text-right">Coût / appel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.byTask.map((row) => (
              <TableRow key={row.task}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: CLASS_COLORS[row.classId] }}
                    />
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap">{row.label}</span>
                      <span className="block font-mono text-2xs text-muted-foreground">{row.task}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right">{num(row.calls)}</TableCell>
                <TableCell className="text-right">
                  {num(row.inputTokens + row.cacheWriteTokens + row.cacheReadTokens + row.outputTokens)}
                </TableCell>
                <TableCell className="text-right font-medium">{usd(row.costUsd)}</TableCell>
                <TableCell className="text-right">{pct(row.share)}</TableCell>
                <TableCell className="text-right">{row.costPerCall === null ? '—' : usd(row.costPerCall)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TopCallsTable({ report }: { report: AiSpendReport }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Les 20 appels les plus chers</CardTitle>
        <CardDescription>
          Heure de Paris. Seuls les compteurs sont conservés : ni prompt ni réponse.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="tabular-nums">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Tâche</TableHead>
              <TableHead>Modèle</TableHead>
              <TableHead className="text-right">Entrée</TableHead>
              <TableHead className="text-right">Cache lu</TableHead>
              <TableHead className="text-right">Cache écrit</TableHead>
              <TableHead className="text-right">Sortie</TableHead>
              <TableHead className="text-right">Coût</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.topCalls.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap">{parisDateTime(c.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{c.taskLabel}</TableCell>
                <TableCell className="whitespace-nowrap">{c.modelLabel}</TableCell>
                <TableCell className="text-right">{num(c.inputTokens)}</TableCell>
                <TableCell className="text-right">{num(c.cacheReadTokens)}</TableCell>
                <TableCell className="text-right">{num(c.cacheWriteTokens)}</TableCell>
                <TableCell className="text-right">{num(c.outputTokens)}</TableCell>
                <TableCell className="text-right font-medium">{usd(c.costUsd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecapCard({ report, onSaved }: { report: AiSpendReport; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/usage/recap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const body = (await res.json()) as { success: boolean; message: string };
      if (!res.ok || !body.success) throw new Error(body.message);
      toast.success(body.message);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p id="recap-label" className="text-sm font-medium">
            Récap hebdomadaire sur Discord
          </p>
          <p className="text-xs text-muted-foreground">
            {report.recap.schedule} : semaine écoulée, mois en cours, projection et l'observation principale.
            Sans appel IA.{' '}
            {!report.recap.webhookConfigured && (
              <span className="text-warning">
                Aucun webhook Discord configuré : rien ne sera envoyé.
              </span>
            )}
            {report.recap.webhookConfigured && 'Envoyé sur le webhook des alertes de budget.'}
          </p>
        </div>
        <Switch
          checked={report.recap.enabled}
          onCheckedChange={toggle}
          disabled={saving}
          aria-labelledby="recap-label"
        />
      </CardContent>
    </Card>
  );
}

function EmptyState({ report }: { report: AiSpendReport }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Coins className="size-5" aria-hidden="true" />
        </div>
        <p className="font-medium">Aucun appel IA enregistré pour l'instant</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Chaque appel (tri, digest, radar, studio…) est compté avec ses tokens et son coût estimé dès
          qu'il a lieu. Cette page se remplira au premier digest ou au premier tri.
          {report.provider === 'github-models' &&
            " Fournisseur actuel : GitHub Models, gratuit (coûts à 0). Le suivi en dollars s'active avec ANTHROPIC_API_KEY."}
        </p>
        <Link to="/settings" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Modèles et budget dans les Paramètres
        </Link>
      </CardContent>
    </Card>
  );
}

export function DepensesIaPage() {
  const [period, setPeriod] = useState<AiSpendPeriod>('month');
  const { data, loading, error, refetch } = useApi<AiSpendReport>(`/api/ai/usage/report?period=${period}`);

  const header = (
    <PageHeader
      title="Dépenses IA"
      description="Coût estimé de chaque appel IA aux prix du catalogue, par tâche et par modèle. Jours et mois au fuseau Europe/Paris ; la Console Anthropic reste la référence de facturation."
    />
  );

  if (error && !data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message={error} context="Impossible de charger les dépenses IA" onRetry={refetch} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-9 w-96 max-w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const dimmed = loading;
  const empty = data.totals.calls === 0;

  return (
    <div className="space-y-6" aria-busy={loading}>
      {header}
      <PeriodPicker value={period} onChange={setPeriod} />

      {!data.hasUsage ? (
        <EmptyState report={data} />
      ) : (
        <div className={cn('space-y-6 transition-opacity', dimmed && 'opacity-80')}>
          {!data.enforced && (
            <Alert>
              <Info className="size-4" />
              <AlertDescription>
                Fournisseur GitHub Models : gratuit, les coûts sont à 0 et aucun budget ne s'applique. Les volumes
                d'appels et de tokens restent suivis.
              </AlertDescription>
            </Alert>
          )}
          <KpiRow report={data} />
          {empty ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Aucun appel IA sur la période « {data.range.label} ». Choisissez une autre période.
              </CardContent>
            </Card>
          ) : (
            <>
              <Insights report={data} />
              <SpendByClassChart report={data} dimmed={dimmed} />
              <div className="grid gap-6 lg:grid-cols-2">
                <CumulativeChart report={data} dimmed={dimmed} />
                <ModelChart report={data} dimmed={dimmed} />
              </div>
              <TokensChart report={data} dimmed={dimmed} />
              <TaskTable report={data} />
              <TopCallsTable report={data} />
            </>
          )}
          <RecapCard report={data} onSaved={refetch} />
        </div>
      )}
    </div>
  );
}
