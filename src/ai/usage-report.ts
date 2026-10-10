/**
 * « Dépenses IA » report: AI spend aggregated from the `ai_usage` ledger
 * (ADR-0027). Rows are summed in SQL per bucket x task x model; the small
 * result set is rolled up here (classes, totals, model share) at full
 * precision. Nothing is rounded except in the French insight sentences.
 *
 * Days and months follow the Europe/Paris calendar: `ai_usage.day` is the
 * Paris date stored at insert time, so DST days (23 h / 25 h) bucket
 * correctly. Calendar arithmetic below works on `YYYY-MM-DD` strings with UTC
 * math, which has no DST.
 *
 * No prompt or answer content is stored in `ai_usage`, so none can leak here.
 */
import { z } from 'zod';
import type { Config } from '../config.js';
import { getDb } from '../db.js';
import { parisDateOf } from '../date-utils.js';
import { getSetting } from '../settings-service.js';
import { BUDGET_WARNING_RATIO, budgetLevel, type BudgetLevel } from './usage.js';
import {
  ANTHROPIC_MODELS,
  findAnthropicModel,
  priceForModel,
  resolveAiProvider,
  type AiProvider,
} from './models.js';
import { AI_TASKS } from './port.js';

export const TIME_ZONE = 'Europe/Paris';

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const USAGE_REPORT_PERIODS = ['7d', '30d', 'month', 'prev-month', '12m'] as const;
export type UsageReportPeriod = (typeof USAGE_REPORT_PERIODS)[number];

export const usageReportQuerySchema = z.object({
  period: z.enum(USAGE_REPORT_PERIODS, {
    errorMap: () => ({
      message: `Période invalide (valeurs possibles : ${USAGE_REPORT_PERIODS.join(', ')}).`,
    }),
  }).default('month'),
});

export const recapSettingSchema = z.object({ enabled: z.boolean() }).strict();

export type UsageBucket = 'day' | 'month';

export interface UsageRange {
  period: UsageReportPeriod | 'week';
  /** Inclusive Paris dates `YYYY-MM-DD`. */
  from: string;
  to: string;
  bucket: UsageBucket;
  /** Calendar days in [from, to]. */
  days: number;
  label: string;
  previous: { from: string; to: string; label: string };
}

const DAY_MS = 86_400_000;

function dayToUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return utcToDay(dayToUtc(day) + n * DAY_MS);
}

export function dayCount(from: string, to: string): number {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / DAY_MS) + 1;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lastDayOf(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** Same day-of-month in another month, clamped to its length. */
function sameDayIn(month: string, dayOfMonth: number): string {
  return `${month}-${String(Math.min(dayOfMonth, daysInMonth(month))).padStart(2, '0')}`;
}

export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function enumerateMonths(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

const monthNameFormatter = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function monthName(month: string): string {
  return monthNameFormatter.format(new Date(dayToUtc(`${month}-01`)));
}

const shortDayFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export function shortDay(day: string): string {
  return shortDayFormatter.format(new Date(dayToUtc(day)));
}

/** Paris calendar range of a period, plus the equal-length range before it. */
export function resolveUsageRange(period: UsageReportPeriod, now: number = Date.now()): UsageRange {
  const today = parisDateOf(now);
  const month = today.slice(0, 7);
  const dom = Number(today.slice(8, 10));
  const make = (
    from: string,
    to: string,
    bucket: UsageBucket,
    label: string,
    previous: UsageRange['previous'],
  ): UsageRange => ({ period, from, to, bucket, days: dayCount(from, to), label, previous });

  switch (period) {
    case '7d':
    case '30d': {
      const n = period === '7d' ? 7 : 30;
      const from = addDays(today, -(n - 1));
      return make(from, today, 'day', `${n} derniers jours`, {
        from: addDays(from, -n),
        to: addDays(from, -1),
        label: `les ${n} jours précédents`,
      });
    }
    case 'month': {
      const prev = addMonths(month, -1);
      return make(`${month}-01`, today, 'day', `Mois en cours (${monthName(month)})`, {
        from: `${prev}-01`,
        to: sameDayIn(prev, dom),
        label: 'la même période du mois précédent',
      });
    }
    case 'prev-month': {
      const prev = addMonths(month, -1);
      const before = addMonths(month, -2);
      return make(`${prev}-01`, lastDayOf(prev), 'day', `Mois précédent (${monthName(prev)})`, {
        from: `${before}-01`,
        to: lastDayOf(before),
        label: "le mois d'avant",
      });
    }
    case '12m': {
      const firstMonth = addMonths(month, -11);
      return make(`${firstMonth}-01`, today, 'month', '12 derniers mois', {
        from: `${addMonths(firstMonth, -12)}-01`,
        to: sameDayIn(addMonths(month, -12), dom),
        label: 'les 12 mois précédents',
      });
    }
  }
}

/** Last complete Monday-to-Sunday Paris week before `now` (weekly recap). */
export function previousWeekRange(now: number = Date.now()): UsageRange {
  const today = parisDateOf(now);
  const weekday = new Date(dayToUtc(today)).getUTCDay(); // 0 = Sunday
  const monday = addDays(today, -((weekday + 6) % 7));
  const from = addDays(monday, -7);
  const to = addDays(monday, -1);
  return {
    period: 'week',
    from,
    to,
    bucket: 'day',
    days: 7,
    label: `semaine du ${shortDay(from)} au ${shortDay(to)}`,
    previous: { from: addDays(from, -7), to: addDays(from, -1), label: 'la semaine précédente' },
  };
}

// ---------------------------------------------------------------------------
// Task classes (chart series): fixed order = fixed colour slot.
// ---------------------------------------------------------------------------

export const TASK_CLASSES = [
  { id: 'triage', label: 'Tri des mentions' },
  { id: 'digest', label: 'Digest de veille' },
  { id: 'radar', label: 'Radar produit' },
  { id: 'studio', label: 'Studio' },
  { id: 'intent', label: "Signaux d'intention" },
  { id: 'monthly', label: 'Résumé mensuel' },
  { id: 'other', label: 'Autres' },
] as const;

export type TaskClassId = (typeof TASK_CLASSES)[number]['id'];

const CLASS_BY_TASK: Record<string, TaskClassId> = {
  'veille.triage': 'triage',
  'veille.digest': 'digest',
  'veille.monthly': 'monthly',
  'radar.score': 'radar',
  'radar.report': 'radar',
  'intent.analyze': 'intent',
  'intent.replies': 'intent',
  'content.generate': 'studio',
  'content.thread': 'studio',
  'content.suggest': 'studio',
};

export function taskClassOf(task: string): TaskClassId {
  return CLASS_BY_TASK[task] ?? 'other';
}

function taskLabel(task: string): string {
  return (AI_TASKS as Record<string, { label: string }>)[task]?.label ?? task;
}

function classLabel(id: TaskClassId): string {
  return TASK_CLASSES.find((c) => c.id === id)!.label;
}

export function modelLabel(model: string): string {
  return findAnthropicModel(model)?.label ?? model;
}

// ---------------------------------------------------------------------------
// Pure metrics
// ---------------------------------------------------------------------------

export interface TokenTotals {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** Share of input tokens served from cache: cache reads / every input token. */
export function cacheRate(t: TokenTotals): number | null {
  const input = t.inputTokens + t.cacheWriteTokens + t.cacheReadTokens;
  return input > 0 ? t.cacheReadTokens / input : null;
}

/**
 * Linear month-end projection: spend so far / days elapsed (today included)
 * x days in the month.
 */
export function projectMonthEnd(spentUsd: number, daysElapsed: number, monthDays: number): number {
  if (daysElapsed <= 0) return 0;
  return (spentUsd / Math.min(daysElapsed, monthDays)) * monthDays;
}

/** Prompt length above which a catalogue model switches to long-context prices. */
const LONG_PROMPT_TOKENS = Math.min(
  ...ANTHROPIC_MODELS.map((m) => m.longContext?.thresholdTokens ?? Infinity),
);

/**
 * Net USD saved by prompt caching on Anthropic: cache reads would have been
 * billed as uncached input, minus the cache-write premium over plain input.
 * Negative when writes are never read back. GitHub Models is free: 0.
 */
export function cacheSavingsUsd(
  provider: string,
  model: string,
  tokens: { cacheReadTokens: number; cacheWriteTokens: number },
  longPrompt = false,
): number {
  if (provider !== 'anthropic') return 0;
  const { price: base, longContext } = priceForModel(model);
  const price = longPrompt && longContext ? longContext.price : base;
  return (
    (tokens.cacheReadTokens * (price.input - price.cacheRead) -
      tokens.cacheWriteTokens * (price.cacheWrite5m - price.input)) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------
// French formatting (insights, Discord recap)
// ---------------------------------------------------------------------------

const usd2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 2 });
const intFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** `4,12 $`; sub-cent amounts keep two significant digits (`0,0042 $`). */
export function formatUsdFr(value: number): string {
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return `${usdSmall.format(value)}\u00a0$`;
  return `${usd2.format(value)}\u00a0$`;
}

export function formatPct(ratio: number): string {
  const pct = ratio * 100;
  if (pct > 0 && pct < 1) return '<\u00a01\u00a0%';
  return `${intFr.format(Math.round(pct))}\u00a0%`;
}

export function formatInt(value: number): string {
  return intFr.format(value);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface UsageTotals extends TokenTotals {
  costUsd: number;
  calls: number;
  cacheRate: number | null;
  avgCostPerCall: number | null;
  avgCostPerDay: number;
}

export interface UsageSeriesPoint extends TokenTotals {
  /** `YYYY-MM-DD` (day buckets) or `YYYY-MM` (month buckets). */
  bucket: string;
  costUsd: number;
  calls: number;
  byClass: Record<TaskClassId, number>;
}

export interface UsageClassRow extends TokenTotals {
  id: TaskClassId;
  label: string;
  calls: number;
  costUsd: number;
  share: number | null;
}

export interface UsageTaskRow extends TokenTotals {
  task: string;
  label: string;
  classId: TaskClassId;
  calls: number;
  costUsd: number;
  share: number | null;
  costPerCall: number | null;
}

export interface UsageModelRow {
  model: string;
  label: string;
  provider: string;
  calls: number;
  costUsd: number;
  share: number | null;
  callShare: number | null;
}

export interface UsageTopCall extends TokenTotals {
  id: number;
  createdAt: number;
  task: string;
  taskLabel: string;
  model: string;
  modelLabel: string;
  costUsd: number;
}

export interface UsageMonthPoint {
  day: string;
  dayOfMonth: number;
  costUsd: number | null;
  cumulativeUsd: number | null;
  projectedUsd: number | null;
}

export interface UsageMonthBlock {
  month: string;
  label: string;
  complete: boolean;
  spentUsd: number;
  daysElapsed: number;
  daysInMonth: number;
  /** Linear on days elapsed; equals spentUsd for a complete month. */
  projectedUsd: number;
  budgetUsd: number;
  budgetRatio: number;
  projectedRatio: number;
  level: BudgetLevel;
  projectedLevel: BudgetLevel;
  points: UsageMonthPoint[];
}

export type InsightTone = 'neutral' | 'good' | 'warning' | 'critical';

export interface UsageInsight {
  id: string;
  tone: InsightTone;
  text: string;
}

export interface UsageReport {
  period: UsageRange['period'];
  range: Omit<UsageRange, 'previous' | 'period'>;
  timeZone: string;
  generatedAt: number;
  provider: AiProvider;
  /** Budget guard active (Anthropic). GitHub Models calls cost 0. */
  enforced: boolean;
  budgetUsd: number;
  warningRatio: number;
  /** At least one call recorded, any date. */
  hasUsage: boolean;
  totals: UsageTotals;
  previous: { from: string; to: string; label: string; costUsd: number; calls: number };
  /** (current - previous) / previous; null without a previous spend. */
  deltaRatio: number | null;
  cacheSavingsUsd: number;
  month: UsageMonthBlock;
  classes: { id: TaskClassId; label: string }[];
  series: UsageSeriesPoint[];
  byClass: UsageClassRow[];
  byTask: UsageTaskRow[];
  byModel: UsageModelRow[];
  topCalls: UsageTopCall[];
  insights: UsageInsight[];
  recap: { enabled: boolean; webhookConfigured: boolean; schedule: string };
}

interface CellRow {
  bucket: string;
  task: string;
  model: string;
  provider: string;
  long_prompt: number;
  calls: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

function emptyTokens(): TokenTotals {
  return { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

function addTokens(target: TokenTotals, row: CellRow): void {
  target.inputTokens += row.input_tokens;
  target.cacheWriteTokens += row.cache_write_tokens;
  target.cacheReadTokens += row.cache_read_tokens;
  target.outputTokens += row.output_tokens;
}

function emptyByClass(): Record<TaskClassId, number> {
  return Object.fromEntries(TASK_CLASSES.map((c) => [c.id, 0])) as Record<TaskClassId, number>;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Ledger cells: one SQL GROUP BY over the range, by bucket x task x model. */
function queryCells(from: string, to: string, bucket: UsageBucket): CellRow[] {
  const bucketExpr = bucket === 'month' ? 'substr(day, 1, 7)' : 'day';
  return getDb()
    .prepare(
      `SELECT ${bucketExpr} AS bucket, task, model, provider,
         (input_tokens + cache_creation_input_tokens + cache_read_input_tokens) > ? AS long_prompt,
         COUNT(*) AS calls,
         SUM(input_tokens) AS input_tokens,
         SUM(cache_creation_input_tokens) AS cache_write_tokens,
         SUM(cache_read_input_tokens) AS cache_read_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(cost_usd) AS cost_usd
       FROM ai_usage WHERE day BETWEEN ? AND ?
       GROUP BY bucket, task, model, provider, long_prompt`,
    )
    .all(LONG_PROMPT_TOKENS, from, to) as CellRow[];
}

function queryTotals(from: string, to: string): { costUsd: number; calls: number } {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
       FROM ai_usage WHERE day BETWEEN ? AND ?`,
    )
    .get(from, to) as { cost: number; calls: number };
  return { costUsd: row.cost, calls: row.calls };
}

function queryDailyCost(from: string, to: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(cost_usd) AS cost FROM ai_usage
       WHERE day BETWEEN ? AND ? GROUP BY day`,
    )
    .all(from, to) as { day: string; cost: number }[];
  return new Map(rows.map((r) => [r.day, r.cost]));
}

function queryTopCalls(from: string, to: string, limit = 20): UsageTopCall[] {
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, task, model, input_tokens, cache_creation_input_tokens,
         cache_read_input_tokens, output_tokens, cost_usd
       FROM ai_usage WHERE day BETWEEN ? AND ?
       ORDER BY cost_usd DESC,
         (input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens) DESC,
         id DESC
       LIMIT ?`,
    )
    .all(from, to, limit) as {
    id: number;
    created_at: number;
    task: string;
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    task: r.task,
    taskLabel: taskLabel(r.task),
    model: r.model,
    modelLabel: modelLabel(r.model),
    inputTokens: r.input_tokens,
    cacheWriteTokens: r.cache_creation_input_tokens,
    cacheReadTokens: r.cache_read_input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
  }));
}

/** Month block: cumulative spend, linear projection, budget ratios. */
export function buildMonthBlock(
  month: string,
  today: string,
  dailyCost: Map<string, number>,
  budgetUsd: number,
): UsageMonthBlock {
  const monthDays = daysInMonth(month);
  const current = today.slice(0, 7) === month;
  const complete = today.slice(0, 7) > month;
  const daysElapsed = current ? Number(today.slice(8, 10)) : complete ? monthDays : 0;
  let cumulative = 0;
  const points: UsageMonthPoint[] = [];
  for (let d = 1; d <= monthDays; d += 1) {
    const day = `${month}-${String(d).padStart(2, '0')}`;
    const elapsed = d <= daysElapsed;
    const cost = elapsed ? (dailyCost.get(day) ?? 0) : null;
    if (cost !== null) cumulative += cost;
    points.push({
      day,
      dayOfMonth: d,
      costUsd: cost,
      cumulativeUsd: elapsed ? cumulative : null,
      projectedUsd: null,
    });
  }
  const spentUsd = cumulative;
  const projectedUsd = complete ? spentUsd : projectMonthEnd(spentUsd, daysElapsed, monthDays);
  if (current && daysElapsed > 0) {
    const perDay = spentUsd / daysElapsed;
    for (const p of points) {
      if (p.dayOfMonth >= daysElapsed) p.projectedUsd = perDay * p.dayOfMonth;
    }
  }
  return {
    month,
    label: monthName(month),
    complete,
    spentUsd,
    daysElapsed,
    daysInMonth: monthDays,
    projectedUsd,
    budgetUsd,
    budgetRatio: budgetUsd > 0 ? spentUsd / budgetUsd : 0,
    projectedRatio: budgetUsd > 0 ? projectedUsd / budgetUsd : 0,
    level: budgetLevel(spentUsd, budgetUsd),
    projectedLevel: budgetLevel(projectedUsd, budgetUsd),
    points,
  };
}

export interface InsightInput {
  range: Pick<UsageRange, 'bucket' | 'days' | 'previous' | 'period'>;
  enforced: boolean;
  totals: UsageTotals;
  previousCostUsd: number;
  deltaRatio: number | null;
  cacheSavingsUsd: number;
  byClass: UsageClassRow[];
  byModel: UsageModelRow[];
  series: Pick<UsageSeriesPoint, 'bucket' | 'costUsd'>[];
  month: Pick<
    UsageMonthBlock,
    'complete' | 'daysElapsed' | 'daysInMonth' | 'projectedUsd' | 'projectedRatio' | 'budgetUsd' | 'label'
  >;
}

const CLASS_SUBJECT: Record<TaskClassId, string> = {
  triage: 'Le tri des mentions',
  digest: 'Le digest de veille',
  radar: 'Le radar produit',
  studio: 'Le studio',
  intent: "L'analyse des signaux",
  monthly: 'Le résumé mensuel',
  other: 'Les autres tâches',
};

/**
 * 3 to 5 plain-French observations, computed (no AI call). Order: month-end
 * projection, biggest class, trend vs previous period, cache, then the most
 * telling of model concentration or a spike day.
 */
export function buildInsights(input: InsightInput): UsageInsight[] {
  const out: UsageInsight[] = [];
  const { totals, month } = input;
  if (totals.calls === 0) return out;

  if (input.enforced && !month.complete && month.daysElapsed > 0) {
    const r = month.projectedRatio;
    out.push({
      id: 'projection',
      tone: r >= 1 ? 'critical' : r >= BUDGET_WARNING_RATIO ? 'warning' : 'good',
      text: `À ce rythme, fin ${month.label} ≈ ${formatUsdFr(month.projectedUsd)} (${formatPct(r)} du budget de ${formatUsdFr(month.budgetUsd)}), projection linéaire sur ${month.daysElapsed} jour${month.daysElapsed > 1 ? 's' : ''} écoulé${month.daysElapsed > 1 ? 's' : ''}.`,
    });
  }

  const paid = input.enforced && totals.costUsd > 0;
  const top = input.byClass[0];
  if (top && top.share !== null && paid) {
    out.push({
      id: 'top-class',
      tone: 'neutral',
      text: `${CLASS_SUBJECT[top.id]} représente ${formatPct(top.share)} des dépenses de la période (${formatUsdFr(top.costUsd)}, ${formatInt(top.calls)} appel${top.calls > 1 ? 's' : ''}).`,
    });
  } else if (top) {
    const callShare = ratio(top.calls, totals.calls) ?? 0;
    out.push({
      id: 'top-class',
      tone: 'neutral',
      text: `${CLASS_SUBJECT[top.id]} représente ${formatPct(callShare)} des appels de la période.`,
    });
  }

  if (paid && input.deltaRatio !== null) {
    const pct = Math.round(Math.abs(input.deltaRatio) * 100);
    const vs = `vs ${input.range.previous.label}`;
    const amounts = `(${formatUsdFr(totals.costUsd)} contre ${formatUsdFr(input.previousCostUsd)})`;
    if (pct < 5) {
      out.push({ id: 'trend', tone: 'neutral', text: `Dépense stable ${vs} ${amounts}.` });
    } else if (input.deltaRatio > 0) {
      out.push({
        id: 'trend',
        tone: input.deltaRatio >= 0.5 ? 'warning' : 'neutral',
        text: `Dépense en hausse de ${pct}\u00a0% ${vs} ${amounts}.`,
      });
    } else {
      out.push({ id: 'trend', tone: 'good', text: `Dépense en baisse de ${pct}\u00a0% ${vs} ${amounts}.` });
    }
  } else if (paid && input.previousCostUsd === 0) {
    out.push({
      id: 'trend',
      tone: 'neutral',
      text: `Aucune dépense sur ${input.range.previous.label} : pas de comparaison possible.`,
    });
  }

  const rate = totals.cacheRate;
  if (input.enforced && rate !== null && (totals.cacheReadTokens > 0 || totals.cacheWriteTokens > 0)) {
    if (input.cacheSavingsUsd >= 0) {
      out.push({
        id: 'cache',
        tone: 'good',
        text: `Le cache a économisé ~${formatUsdFr(input.cacheSavingsUsd)} (${formatPct(rate)} des tokens d'entrée lus en cache, net du surcoût des écritures).`,
      });
    } else {
      out.push({
        id: 'cache',
        tone: 'warning',
        text: `Le cache a coûté ${formatUsdFr(-input.cacheSavingsUsd)} de plus qu'il n'a rapporté : les écritures sont peu relues (${formatPct(rate)} des tokens d'entrée lus en cache).`,
      });
    }
  } else if (input.enforced && totals.inputTokens > 0) {
    out.push({
      id: 'cache',
      tone: 'neutral',
      text: "Aucun token lu en cache sur la période : les prompts répétés ne profitent pas encore du cache.",
    });
  }

  if (paid) {
    const skew = input.byModel
      .filter((m) => m.share !== null && m.callShare !== null)
      .map((m) => ({ m, gap: (m.share ?? 0) - (m.callShare ?? 0) }))
      .sort((a, b) => b.gap - a.gap)[0];
    if (input.byModel.length > 1 && skew && skew.gap >= 0.2) {
      out.push({
        id: 'model-skew',
        tone: 'warning',
        text: `${skew.m.label} : ${formatPct(skew.m.callShare ?? 0)} des appels mais ${formatPct(skew.m.share ?? 0)} du coût.`,
      });
    } else if (input.range.bucket === 'day' && input.series.length >= 3) {
      const avg = totals.costUsd / input.series.length;
      const peak = input.series.reduce((a, b) => (b.costUsd > a.costUsd ? b : a));
      if (avg > 0 && peak.costUsd >= 2 * avg) {
        const factor = (peak.costUsd / avg).toFixed(1).replace('.', ',');
        out.push({
          id: 'peak',
          tone: 'neutral',
          text: `Pic le ${shortDay(peak.bucket)} : ${formatUsdFr(peak.costUsd)}, ${factor}× la moyenne quotidienne.`,
        });
      }
    }
  }

  return out.slice(0, 5);
}

export function isWeeklyRecapEnabled(config: Pick<Config, 'AI_WEEKLY_RECAP_ENABLED'>): boolean {
  const stored = getSetting('AI_WEEKLY_RECAP_ENABLED');
  if (stored === 'true' || stored === '1') return true;
  if (stored === 'false' || stored === '0') return false;
  return config.AI_WEEKLY_RECAP_ENABLED ?? true;
}

export type UsageReportConfig = Pick<
  Config,
  | 'AI_PROVIDER'
  | 'ANTHROPIC_API_KEY'
  | 'AI_MONTHLY_BUDGET_USD'
  | 'AI_WEEKLY_RECAP_ENABLED'
  | 'DISCORD_WEBHOOK_URL'
  | 'VEILLE_DISCORD_WEBHOOK_URL'
>;

export interface UsageReportDeps {
  now?: number;
  /** Alert webhook resolution (usage.ts); injected to keep this module testable. */
  webhookConfigured?: boolean;
}

/** Full report for a range. Every amount is at full precision. */
export function buildUsageReport(
  config: UsageReportConfig,
  range: UsageRange,
  deps: UsageReportDeps = {},
): UsageReport {
  const now = deps.now ?? Date.now();
  const today = parisDateOf(now);
  const provider = resolveAiProvider(config);
  const enforced = provider === 'anthropic';
  const budgetUsd = config.AI_MONTHLY_BUDGET_USD;

  const cells = queryCells(range.from, range.to, range.bucket);

  const tokens = emptyTokens();
  let costUsd = 0;
  let calls = 0;
  let savings = 0;
  const seriesMap = new Map<string, UsageSeriesPoint>();
  const buckets =
    range.bucket === 'month' ? enumerateMonths(range.from, range.to) : enumerateDays(range.from, range.to);
  for (const b of buckets) {
    seriesMap.set(b, { bucket: b, costUsd: 0, calls: 0, byClass: emptyByClass(), ...emptyTokens() });
  }
  const classMap = new Map<TaskClassId, UsageClassRow>();
  const taskMap = new Map<string, UsageTaskRow>();
  const modelMap = new Map<string, UsageModelRow>();

  for (const cell of cells) {
    const cls = taskClassOf(cell.task);
    costUsd += cell.cost_usd;
    calls += cell.calls;
    addTokens(tokens, cell);
    savings += cacheSavingsUsd(
      cell.provider,
      cell.model,
      { cacheReadTokens: cell.cache_read_tokens, cacheWriteTokens: cell.cache_write_tokens },
      cell.long_prompt === 1,
    );

    const point = seriesMap.get(cell.bucket);
    if (point) {
      point.costUsd += cell.cost_usd;
      point.calls += cell.calls;
      point.byClass[cls] += cell.cost_usd;
      addTokens(point, cell);
    }

    const c =
      classMap.get(cls) ??
      ({ id: cls, label: classLabel(cls), calls: 0, costUsd: 0, share: null, ...emptyTokens() } as UsageClassRow);
    c.calls += cell.calls;
    c.costUsd += cell.cost_usd;
    addTokens(c, cell);
    classMap.set(cls, c);

    const t =
      taskMap.get(cell.task) ??
      ({
        task: cell.task,
        label: taskLabel(cell.task),
        classId: cls,
        calls: 0,
        costUsd: 0,
        share: null,
        costPerCall: null,
        ...emptyTokens(),
      } as UsageTaskRow);
    t.calls += cell.calls;
    t.costUsd += cell.cost_usd;
    addTokens(t, cell);
    taskMap.set(cell.task, t);

    const m =
      modelMap.get(cell.model) ??
      ({
        model: cell.model,
        label: modelLabel(cell.model),
        provider: cell.provider,
        calls: 0,
        costUsd: 0,
        share: null,
        callShare: null,
      } as UsageModelRow);
    m.calls += cell.calls;
    m.costUsd += cell.cost_usd;
    modelMap.set(cell.model, m);
  }

  const byCost = <T extends { costUsd: number; calls: number }>(a: T, b: T) =>
    b.costUsd - a.costUsd || b.calls - a.calls;
  const byClass = [...classMap.values()]
    .map((c) => ({ ...c, share: ratio(c.costUsd, costUsd) }))
    .sort(byCost);
  const byTask = [...taskMap.values()]
    .map((t) => ({ ...t, share: ratio(t.costUsd, costUsd), costPerCall: ratio(t.costUsd, t.calls) }))
    .sort(byCost);
  const byModel = [...modelMap.values()]
    .map((m) => ({ ...m, share: ratio(m.costUsd, costUsd), callShare: ratio(m.calls, calls) }))
    .sort(byCost);

  const totals: UsageTotals = {
    ...tokens,
    costUsd,
    calls,
    cacheRate: cacheRate(tokens),
    avgCostPerCall: ratio(costUsd, calls),
    avgCostPerDay: costUsd / Math.max(1, range.days),
  };

  const previous = queryTotals(range.previous.from, range.previous.to);
  const deltaRatio = previous.costUsd > 0 ? (costUsd - previous.costUsd) / previous.costUsd : null;

  const refMonth = range.period === 'prev-month' ? range.from.slice(0, 7) : today.slice(0, 7);
  const month = buildMonthBlock(
    refMonth,
    today,
    queryDailyCost(`${refMonth}-01`, lastDayOf(refMonth)),
    budgetUsd,
  );

  const series = [...seriesMap.values()];
  const insights = buildInsights({
    range,
    enforced,
    totals,
    previousCostUsd: previous.costUsd,
    deltaRatio,
    cacheSavingsUsd: savings,
    byClass,
    byModel,
    series,
    month,
  });

  const hasUsage = calls > 0 || Boolean(getDb().prepare('SELECT 1 FROM ai_usage LIMIT 1').get());

  return {
    period: range.period,
    range: { from: range.from, to: range.to, bucket: range.bucket, days: range.days, label: range.label },
    timeZone: TIME_ZONE,
    generatedAt: now,
    provider,
    enforced,
    budgetUsd,
    warningRatio: BUDGET_WARNING_RATIO,
    hasUsage,
    totals,
    previous: { ...range.previous, ...previous },
    deltaRatio,
    cacheSavingsUsd: savings,
    month,
    classes: TASK_CLASSES.map((c) => ({ id: c.id, label: c.label })),
    series,
    byClass,
    byTask,
    byModel,
    topCalls: queryTopCalls(range.from, range.to),
    insights,
    recap: {
      enabled: isWeeklyRecapEnabled(config),
      webhookConfigured: deps.webhookConfigured ?? false,
      schedule: 'Lundi 9:00 (Europe/Paris)',
    },
  };
}
