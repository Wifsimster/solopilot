// Charts of the « Dépenses IA » page (Recharts via the shadcn ChartContainer,
// ADR-0021). Mark specs follow the dataviz method: bars <= 24 px with a 4 px
// rounded data end and a 2 px surface gap between stacked segments, 2 px
// lines, hairline solid grid, legend for >= 2 series, value-first tooltips,
// and a data table under every chart (tooltips never gate a value).
import { useId, type ReactNode } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { AiSpendReport, AiTaskClassId } from '@/types';
import { bucketLong, bucketShort, niceScale, num, pct, tokensCompact, usd, usdTick } from './format';

/** Fixed slot per class: colour follows the entity, never its rank. */
export const CLASS_COLORS: Record<AiTaskClassId, string> = {
  triage: 'var(--series-1)',
  digest: 'var(--series-2)',
  radar: 'var(--series-3)',
  studio: 'var(--series-4)',
  intent: 'var(--series-5)',
  monthly: 'var(--series-6)',
  other: 'var(--series-7)',
};

export const TOKEN_TYPES = [
  { key: 'inputTokens', label: 'Entrée', color: 'var(--series-1)' },
  { key: 'cacheReadTokens', label: 'Cache lu', color: 'var(--series-2)' },
  { key: 'cacheWriteTokens', label: 'Cache écrit', color: 'var(--series-3)' },
  { key: 'outputTokens', label: 'Sortie', color: 'var(--series-4)' },
] as const;

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };
const GAP = 2;
const RADIUS = 4;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

interface ChartFigureProps {
  title: string;
  description: string;
  /** One-sentence reading of the chart for screen readers. */
  summary: string;
  legend?: ReactNode;
  table: ReactNode;
  children: ReactNode;
  className?: string;
  dimmed?: boolean;
}

/** Card-level figure: title, aria summary, legend, chart and its table twin. */
export function ChartFigure({
  title,
  description,
  summary,
  legend,
  table,
  children,
  className,
  dimmed,
}: ChartFigureProps) {
  const id = useId();
  return (
    <figure
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-summary`}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5',
        className,
      )}
    >
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="text-sm font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
        <p id={`${id}-summary`} className="sr-only">
          {summary}
        </p>
      </div>
      {legend}
      <div className={cn('transition-opacity', dimmed && 'opacity-60')}>{children}</div>
      <details className="group text-xs">
        <summary className="cursor-pointer select-none rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Voir les données en tableau
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">{table}</div>
      </details>
    </figure>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; kind?: 'rect' | 'line' | 'dashed' }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Légende">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.kind === 'line' || item.kind === 'dashed' ? (
            <svg width="16" height="8" aria-hidden="true" className="shrink-0">
              <line
                x1="1"
                x2="15"
                y1="4"
                y2="4"
                stroke={item.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={item.kind === 'dashed' ? '4 3' : undefined}
              />
            </svg>
          ) : (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: item.color }}
            />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left tabular-nums">
      <thead>
        <tr className="border-b">
          {head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={cn('py-1.5 pr-3 font-medium text-muted-foreground', i > 0 && 'text-right')}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])} className="border-b border-border/60 last:border-0">
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="py-1.5 pr-3 font-normal">
                  {cell}
                </th>
              ) : (
                <td key={i} className="py-1.5 pr-3 text-right">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface TooltipRow {
  label: string;
  color: string;
  value: string;
  dashed?: boolean;
}

function TooltipBox({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: string }) {
  return (
    <div className="grid min-w-[10rem] gap-1.5 rounded-lg border border-border/60 bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <svg width="10" height="8" aria-hidden="true" className="shrink-0">
            <line
              x1="1"
              x2="9"
              y1="4"
              y2="4"
              stroke={r.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={r.dashed ? '3 2' : undefined}
            />
          </svg>
          <span className="font-semibold tabular-nums text-foreground">{r.value}</span>
          <span className="text-muted-foreground">{r.label}</span>
        </div>
      ))}
      {footer && <div className="border-t pt-1.5 text-muted-foreground">{footer}</div>}
    </div>
  );
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: Record<string, unknown>;
}

function roundedTopPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/**
 * One stacked segment: the top segment of a column gets the rounded data end;
 * the others leave a 2 px surface gap above them. Square at the baseline.
 */
function stackSegment(key: string) {
  return function StackSegment(props: unknown) {
    const { x = 0, y = 0, width = 0, height = 0, fill, payload } = props as ShapeProps;
    if (height <= 0 || width <= 0) return <g />;
    const isTop = payload?.__top === key;
    if (isTop) return <path d={roundedTopPath(x, y, width, height, RADIUS)} fill={fill} />;
    const gap = height > GAP + 1 ? GAP : 0;
    return <rect x={x} y={y + gap} width={width} height={height - gap} fill={fill} />;
  };
}

function withTop<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T & { __top: string | null } {
  let top: string | null = null;
  for (const k of keys) if (Number(row[k] ?? 0) > 0) top = k;
  return { ...row, __top: top };
}

interface StackedSeries {
  key: string;
  label: string;
  color: string;
}

interface StackedBarsProps {
  data: Record<string, unknown>[];
  series: StackedSeries[];
  format: (v: number) => string;
  tick: (v: number) => string;
  totalLabel: string;
}

function StackedBars({ data, series, format, tick, totalLabel }: StackedBarsProps) {
  const keys = series.map((s) => s.key);
  const rows = data.map((d) => withTop(d, keys));
  const scale = niceScale(Math.max(0, ...rows.map((r) => keys.reduce((sum, k) => sum + Number(r[k] ?? 0), 0))));
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72">
      <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
          tickMargin={8}
          minTickGap={16}
          tick={AXIS_TICK}
          tickFormatter={(b: string) => bucketShort(b)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={60}
          tick={AXIS_TICK}
          domain={scale.domain}
          ticks={scale.ticks}
          tickFormatter={(v: number) => tick(v)}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={(p: unknown) => {
            const { active, payload, label } = p as {
              active?: boolean;
              payload?: { payload: Record<string, unknown> }[];
              label?: string;
            };
            if (!active || !payload?.length) return null;
            const row = payload[0].payload;
            const total = keys.reduce((s, k) => s + Number(row[k] ?? 0), 0);
            return (
              <TooltipBox
                title={bucketLong(String(label ?? row.bucket))}
                rows={[...series].reverse().map((s) => ({
                  label: s.label,
                  color: s.color,
                  value: format(Number(row[s.key] ?? 0)),
                }))}
                footer={`${totalLabel} : ${format(total)}`}
              />
            );
          }}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="stack"
            fill={s.color}
            maxBarSize={24}
            isAnimationActive={false}
            shape={stackSegment(s.key)}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// (1) Spend per day (or month) stacked by task class
// ---------------------------------------------------------------------------

export function SpendByClassChart({ report, dimmed }: { report: AiSpendReport; dimmed?: boolean }) {
  const present = report.classes.filter((c) => report.series.some((p) => p.byClass[c.id] > 0));
  const series = present.map((c) => ({ key: c.id, label: c.label, color: CLASS_COLORS[c.id] }));
  const data = report.series.map((p) => ({ bucket: p.bucket, ...p.byClass }));
  const perMonth = report.range.bucket === 'month';
  const peak = report.series.reduce(
    (a, b) => (b.costUsd > a.costUsd ? b : a),
    report.series[0] ?? { bucket: '', costUsd: 0 },
  );
  return (
    <ChartFigure
      dimmed={dimmed}
      title={perMonth ? 'Dépense mensuelle par type de tâche' : 'Dépense quotidienne par type de tâche'}
      description={`${report.range.label}, empilée par type de tâche (USD estimés, Europe/Paris).`}
      summary={`Total ${usd(report.totals.costUsd)} sur la période. ${
        peak.costUsd > 0 ? `${perMonth ? 'Mois' : 'Jour'} le plus cher : ${bucketLong(peak.bucket)} (${usd(peak.costUsd)}).` : ''
      }`}
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      table={
        <DataTable
          head={[perMonth ? 'Mois' : 'Jour', ...series.map((s) => s.label), 'Total']}
          rows={report.series.map((p) => [
            bucketLong(p.bucket),
            ...series.map((s) => usd(p.byClass[s.key as AiTaskClassId])),
            usd(p.costUsd),
          ])}
        />
      }
    >
      <StackedBars data={data} series={series} format={usd} tick={usdTick} totalLabel="Total" />
    </ChartFigure>
  );
}

// ---------------------------------------------------------------------------
// (2) Cumulative month spend vs budget, with the linear projection
// ---------------------------------------------------------------------------

export function CumulativeChart({ report, dimmed }: { report: AiSpendReport; dimmed?: boolean }) {
  const m = report.month;
  const maxValue = Math.max(m.projectedUsd, m.spentUsd);
  // A 200 $ budget line would flatten a 3 $ month: show it only when the curve
  // reaches a quarter of it, otherwise say it is off scale.
  const budgetOnScale = report.enforced && maxValue >= m.budgetUsd * 0.25;
  const scale = niceScale(budgetOnScale ? Math.max(m.budgetUsd, maxValue) : maxValue);
  const lastActual = m.points.filter((p) => p.cumulativeUsd !== null).at(-1);
  const data = m.points.map((p) => ({ ...p, bucket: p.day }));
  const showProjection = !m.complete && m.daysElapsed > 0;
  const config = {
    cumulativeUsd: { label: 'Cumul', color: 'var(--series-1)' },
    projectedUsd: { label: 'Projection', color: 'var(--series-1)' },
  } satisfies ChartConfig;

  const legendItems: { label: string; color: string; kind: 'line' | 'dashed' }[] = [
    { label: 'Dépense cumulée', color: 'var(--series-1)', kind: 'line' },
  ];
  if (showProjection) legendItems.push({ label: 'Projection linéaire', color: 'var(--series-1)', kind: 'dashed' });
  if (budgetOnScale) legendItems.push({ label: `Budget ${usd(m.budgetUsd)}`, color: 'var(--destructive)', kind: 'line' });

  return (
    <ChartFigure
      dimmed={dimmed}
      title={`Cumul de ${m.label} vs budget`}
      description={
        showProjection
          ? `Projection linéaire : dépense ÷ ${m.daysElapsed} jour${m.daysElapsed > 1 ? 's' : ''} écoulé${m.daysElapsed > 1 ? 's' : ''} × ${m.daysInMonth} jours.`
          : 'Mois complet : dépense réelle cumulée.'
      }
      summary={`Dépensé ${usd(m.spentUsd)} sur ${usd(m.budgetUsd)} de budget (${pct(m.budgetRatio)}).${
        showProjection ? ` Fin de mois projetée : ${usd(m.projectedUsd)} (${pct(m.projectedRatio)} du budget).` : ''
      }`}
      legend={
        <div className="space-y-1">
          <Legend items={legendItems} />
          {report.enforced && !budgetOnScale && (
            <p className="text-xs text-muted-foreground">
              Budget de {usd(m.budgetUsd)} hors échelle : la projection en atteint {pct(m.projectedRatio)}.
            </p>
          )}
        </div>
      }
      table={
        <DataTable
          head={['Jour', 'Dépense', 'Cumul', 'Projection']}
          rows={m.points.map((p) => [
            bucketLong(p.day),
            p.costUsd === null ? '—' : usd(p.costUsd),
            p.cumulativeUsd === null ? '—' : usd(p.cumulativeUsd),
            p.projectedUsd === null ? '—' : usd(p.projectedUsd),
          ])}
        />
      }
    >
      <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72">
        <ComposedChart accessibilityLayer data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="dayOfMonth"
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickMargin={8}
            minTickGap={12}
            tick={AXIS_TICK}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={60}
            tick={AXIS_TICK}
            tickFormatter={(v: number) => usdTick(v)}
            domain={scale.domain}
            ticks={scale.ticks}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
            content={(p: unknown) => {
              const { active, payload } = p as {
                active?: boolean;
                payload?: { payload: (typeof data)[number] }[];
              };
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              const rows: TooltipRow[] = [];
              if (row.cumulativeUsd !== null)
                rows.push({ label: 'cumul', color: 'var(--series-1)', value: usd(row.cumulativeUsd) });
              if (row.projectedUsd !== null && showProjection)
                rows.push({ label: 'projection', color: 'var(--series-1)', value: usd(row.projectedUsd), dashed: true });
              if (row.costUsd !== null)
                rows.push({ label: 'ce jour', color: 'var(--muted-foreground)', value: usd(row.costUsd) });
              return <TooltipBox title={bucketLong(row.day)} rows={rows} />;
            }}
          />
          {budgetOnScale && (
            <ReferenceLine
              y={m.budgetUsd}
              stroke="var(--destructive)"
              strokeWidth={1}
              ifOverflow="extendDomain"
              label={{
                value: `Budget ${usd(m.budgetUsd)}`,
                position: 'insideTopLeft',
                fill: 'var(--muted-foreground)',
                fontSize: 11,
              }}
            />
          )}
          <Area
            type="linear"
            dataKey="cumulativeUsd"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="var(--series-1)"
            fillOpacity={0.1}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
          >
            <LabelList
              dataKey="cumulativeUsd"
              content={(lp: unknown) => {
                const { x, y, index } = lp as { x?: number; y?: number; index?: number };
                if (!lastActual || index !== lastActual.dayOfMonth - 1 || x === undefined || y === undefined)
                  return null;
                return (
                  <g>
                    <circle cx={x} cy={y} r={4} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />
                    <text x={x - 6} y={y - 10} textAnchor="end" fontSize={11} fill="var(--foreground)" fontWeight={600}>
                      {usd(lastActual.cumulativeUsd ?? 0)}
                    </text>
                  </g>
                );
              }}
            />
          </Area>
          {showProjection && (
            <Line
              type="linear"
              dataKey="projectedUsd"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeOpacity={0.75}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="projectedUsd"
                content={(lp: unknown) => {
                  const { x, y, index } = lp as { x?: number; y?: number; index?: number };
                  if (index !== m.daysInMonth - 1 || x === undefined || y === undefined) return null;
                  return (
                    <text x={x} y={y - 8} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
                      ≈ {usd(m.projectedUsd)}
                    </text>
                  );
                }}
              />
            </Line>
          )}
        </ComposedChart>
      </ChartContainer>
    </ChartFigure>
  );
}

// ---------------------------------------------------------------------------
// (3) Spend by model (horizontal bars, one series)
// ---------------------------------------------------------------------------

export function ModelChart({ report, dimmed }: { report: AiSpendReport; dimmed?: boolean }) {
  const byCost = report.enforced;
  const metric = byCost ? 'costUsd' : 'calls';
  const fmt = (v: number) => (byCost ? usd(v) : `${num(v)} appels`);
  const data = report.byModel.map((m) => ({ ...m, value: m[metric] }));
  const height = Math.max(120, data.length * 44 + 32);
  const config = { value: { label: byCost ? 'Coût' : 'Appels', color: 'var(--series-1)' } } satisfies ChartConfig;
  const top = data[0];
  const scale = byCost ? niceScale(Math.max(0, ...data.map((d) => d.value)), 3) : undefined;
  return (
    <ChartFigure
      dimmed={dimmed}
      title={byCost ? 'Dépense par modèle' : 'Appels par modèle'}
      description={`${report.range.label}. ${byCost ? 'Coût estimé aux prix catalogue.' : 'GitHub Models est gratuit : volume d’appels.'}`}
      summary={top ? `${top.label} : ${fmt(top.value)} (${pct(byCost ? top.share : top.callShare)}).` : 'Aucun appel.'}
      table={
        <DataTable
          head={['Modèle', 'Appels', 'Coût', 'Part du coût', 'Part des appels']}
          rows={report.byModel.map((m) => [m.label, num(m.calls), usd(m.costUsd), pct(m.share), pct(m.callShare)])}
        />
      }
    >
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 72, left: 0, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            domain={scale?.domain}
            ticks={scale?.ticks}
            tickFormatter={(v: number) => (byCost ? usdTick(v) : tokensCompact(v))}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            width={136}
            tick={(tp: unknown) => {
              // Plain <text>: Recharts' default tick wraps "Claude Sonnet 5.5".
              const { x, y, payload } = tp as { x: number; y: number; payload: { value: string } };
              return (
                <text x={x - 6} y={y} dy={4} textAnchor="end" fontSize={11} fill="var(--foreground)">
                  {payload.value}
                </text>
              );
            }}
          />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={(p: unknown) => {
              const { active, payload } = p as { active?: boolean; payload?: { payload: (typeof data)[number] }[] };
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <TooltipBox
                  title={row.label}
                  rows={[
                    { label: 'coût', color: 'var(--series-1)', value: usd(row.costUsd) },
                    { label: 'appels', color: 'var(--muted-foreground)', value: num(row.calls) },
                  ]}
                  footer={`${pct(row.share)} du coût · ${pct(row.callShare)} des appels`}
                />
              );
            }}
          />
          <Bar dataKey="value" fill="var(--series-1)" radius={[0, RADIUS, RADIUS, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="right"
              offset={8}
              fontSize={11}
              fill="var(--foreground)"
              formatter={(v: unknown) => fmt(Number(v))}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFigure>
  );
}

// ---------------------------------------------------------------------------
// (4) Tokens by type over time
// ---------------------------------------------------------------------------

export function TokensChart({ report, dimmed }: { report: AiSpendReport; dimmed?: boolean }) {
  const present = TOKEN_TYPES.filter((t) => report.totals[t.key] > 0);
  const series = present.map((t) => ({ key: t.key, label: t.label, color: t.color }));
  const data = report.series.map((p) => ({
    bucket: p.bucket,
    inputTokens: p.inputTokens,
    cacheReadTokens: p.cacheReadTokens,
    cacheWriteTokens: p.cacheWriteTokens,
    outputTokens: p.outputTokens,
  }));
  const perMonth = report.range.bucket === 'month';
  const t = report.totals;
  return (
    <ChartFigure
      dimmed={dimmed}
      title={perMonth ? 'Tokens par mois et par type' : 'Tokens par jour et par type'}
      description="Entrée non mise en cache, lectures et écritures de cache, sortie (réflexion incluse)."
      summary={`Sur la période : ${num(t.inputTokens)} tokens d'entrée, ${num(t.cacheReadTokens)} lus en cache, ${num(
        t.cacheWriteTokens,
      )} écrits en cache, ${num(t.outputTokens)} en sortie. Taux de cache ${pct(t.cacheRate)}.`}
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      table={
        <DataTable
          head={[perMonth ? 'Mois' : 'Jour', ...TOKEN_TYPES.map((x) => x.label)]}
          rows={report.series.map((p) => [bucketLong(p.bucket), ...TOKEN_TYPES.map((x) => num(p[x.key]))])}
        />
      }
    >
      <StackedBars data={data} series={series} format={(v) => num(v)} tick={tokensCompact} totalLabel="Total tokens" />
    </ChartFigure>
  );
}
