/**
 * AI usage ledger + monthly budget guard (ADR-0027).
 *
 * Every call is recorded in `ai_usage` with its estimated cost. On the
 * Anthropic provider the month-to-date spend is compared to
 * `AI_MONTHLY_BUDGET_USD`: a one-time warning at 80 % (logs + Discord + UI) and,
 * at 100 %, non-essential tasks are refused until the next Paris month.
 */
import type { Config } from '../config.js';
import { getDb } from '../db.js';
import { getSetting } from '../settings-service.js';
import { sendDiscordEmbeds } from '../adapters/discord-notifier.js';
import { logger } from '../logger.js';
import { AiError } from './errors.js';
import { resolveAiModel, resolveAiProvider, type AiProvider } from './models.js';
import { readAiModelSettings } from './settings.js';
import { AI_TASKS, type AiCallUsage, type AiTask } from './port.js';

export const BUDGET_WARNING_RATIO = 0.8;

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
});

/** Europe/Paris `YYYY-MM` of a timestamp. */
export function parisMonth(now: number = Date.now()): string {
  const parts = monthFormatter.formatToParts(new Date(now));
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
}

export function recordAiUsage(usage: AiCallUsage, now: number = Date.now()): void {
  getDb()
    .prepare(
      `INSERT INTO ai_usage (created_at, month, provider, model, task, input_tokens, output_tokens,
        cache_creation_input_tokens, cache_read_input_tokens, stop_reason, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      now,
      parisMonth(now),
      usage.provider,
      usage.model,
      usage.task,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheCreationInputTokens,
      usage.cacheReadInputTokens,
      usage.stopReason,
      usage.costUsd,
    );
}

export function getMonthSpendUsd(month: string = parisMonth()): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM ai_usage WHERE month = ?')
    .get(month) as { spent: number };
  return row.spent;
}

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export function budgetLevel(spentUsd: number, budgetUsd: number): BudgetLevel {
  if (spentUsd >= budgetUsd) return 'exceeded';
  if (spentUsd >= budgetUsd * BUDGET_WARNING_RATIO) return 'warning';
  return 'ok';
}

function formatUsd(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} $`;
}

const NON_ESSENTIAL_LABELS = Object.values(AI_TASKS)
  .filter((t) => !t.essential)
  .map((t) => t.label);

/**
 * Refuses a non-essential task once the month's Anthropic budget is spent.
 * GitHub Models is free: never blocked.
 */
export function assertWithinBudget(
  config: Config,
  provider: AiProvider,
  task: AiTask,
  now?: number,
): void {
  if (provider !== 'anthropic' || AI_TASKS[task].essential) return;
  const budget = config.AI_MONTHLY_BUDGET_USD;
  const spent = getMonthSpendUsd(parisMonth(now));
  if (spent >= budget) {
    throw new AiError(
      'budget_exceeded',
      `Budget IA mensuel atteint (${formatUsd(spent)} / ${formatUsd(budget)}) : « ${AI_TASKS[task].label} » est suspendu jusqu'au 1er du mois prochain. Augmentez AI_MONTHLY_BUDGET_USD pour lever la limite.`,
    );
  }
}

function resolveAlertWebhook(config: Config): string | undefined {
  return (
    getSetting('DISCORD_WEBHOOK_URL') ||
    config.DISCORD_WEBHOOK_URL ||
    getSetting('VEILLE_DISCORD_WEBHOOK_URL') ||
    config.VEILLE_DISCORD_WEBHOOK_URL ||
    undefined
  );
}

export interface BudgetAlertDeps {
  notify?: (webhookUrl: string, title: string, description: string) => Promise<unknown>;
  now?: number;
}

/**
 * After a recorded call: fire the 80 % / 100 % alert once per month. Returns
 * the level that was newly alerted (tests), or null.
 */
export async function checkBudgetAlerts(
  config: Config,
  deps: BudgetAlertDeps = {},
): Promise<BudgetLevel | null> {
  const month = parisMonth(deps.now);
  const budget = config.AI_MONTHLY_BUDGET_USD;
  const spent = getMonthSpendUsd(month);
  const level = budgetLevel(spent, budget);
  if (level === 'ok') return null;

  const inserted = getDb()
    .prepare(
      'INSERT OR IGNORE INTO ai_budget_alerts (month, level, spent_usd, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(month, level, spent, deps.now ?? Date.now());
  if (inserted.changes === 0) return null;

  const pct = Math.floor((spent / budget) * 100);
  const title =
    level === 'exceeded' ? '⛔ Budget IA mensuel atteint' : `⚠️ Budget IA : ${pct} % consommés`;
  const description =
    level === 'exceeded'
      ? `${formatUsd(spent)} dépensés sur ${formatUsd(budget)} (${month}). Suspendus jusqu'au 1er du mois : ${NON_ESSENTIAL_LABELS.join(', ')}. Le digest de veille et le tri des mentions continuent.`
      : `${formatUsd(spent)} dépensés sur ${formatUsd(budget)} (${month}). À 100 %, les tâches non essentielles seront suspendues.`;

  logger.warn('AI monthly budget threshold reached', {
    month,
    level,
    spentUsd: spent,
    budgetUsd: budget,
  });

  const webhook = resolveAlertWebhook(config);
  if (!webhook) return level;
  const notify =
    deps.notify ??
    ((url: string, t: string, d: string) =>
      sendDiscordEmbeds(url, [
        { title: t, description: d, color: level === 'exceeded' ? 0xdc2626 : 0xf59e0b },
      ]));
  try {
    await notify(webhook, title, description);
  } catch (err) {
    logger.warn('AI budget alert not delivered', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return level;
}

export interface AiUsageTaskRow {
  task: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
}

export interface AiBudgetStatus {
  provider: AiProvider;
  model: string;
  fastModel: string;
  month: string;
  budgetUsd: number;
  spentUsd: number;
  level: BudgetLevel;
  /** True when the budget guard applies (Anthropic provider). */
  enforced: boolean;
  byTask: AiUsageTaskRow[];
}

/** Month-to-date summary for the Settings page. Never exposes any key. */
export function getAiBudgetStatus(config: Config, now?: number): AiBudgetStatus {
  const provider = resolveAiProvider(config);
  const month = parisMonth(now);
  const spentUsd = getMonthSpendUsd(month);
  const byTask = getDb()
    .prepare(
      `SELECT task, COUNT(*) AS calls, SUM(input_tokens + cache_creation_input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens, SUM(cache_read_input_tokens) AS cache_read_input_tokens,
         ROUND(SUM(cost_usd), 4) AS cost_usd
       FROM ai_usage WHERE month = ? GROUP BY task ORDER BY cost_usd DESC, calls DESC`,
    )
    .all(month) as AiUsageTaskRow[];
  const settings = readAiModelSettings();
  return {
    provider,
    model: resolveAiModel(config, provider, 'default', settings),
    fastModel: resolveAiModel(config, provider, 'fast', settings),
    month,
    budgetUsd: config.AI_MONTHLY_BUDGET_USD,
    spentUsd: Math.round(spentUsd * 100) / 100,
    level: budgetLevel(spentUsd, config.AI_MONTHLY_BUDGET_USD),
    enforced: provider === 'anthropic',
    byTask,
  };
}
