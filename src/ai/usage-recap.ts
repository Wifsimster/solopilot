/**
 * Weekly « Dépenses IA » recap on Discord: Monday 09:00 Europe/Paris, last
 * complete Monday-to-Sunday week. Built from the usage report (no AI call),
 * sent once per week (`ai_usage_recaps`) on the budget-alert webhook. Behind
 * the AI_WEEKLY_RECAP_ENABLED setting (default on).
 */
import { getDb } from '../db.js';
import { sendDiscordEmbeds, type DiscordEmbed } from '../adapters/discord-notifier.js';
import { logger } from '../logger.js';
import { resolveAlertWebhook } from './usage.js';
import {
  buildUsageReport,
  formatInt,
  formatPct,
  formatUsdFr,
  isWeeklyRecapEnabled,
  previousWeekRange,
  type UsageReport,
  type UsageReportConfig,
} from './usage-report.js';

export const WEEKLY_RECAP_CRON = '0 9 * * 1';

const LEVEL_COLORS = { ok: 0x16a34a, warning: 0xf59e0b, exceeded: 0xdc2626 } as const;

function deltaText(report: UsageReport): string {
  if (report.deltaRatio === null) return '';
  const pct = Math.round(Math.abs(report.deltaRatio) * 100);
  if (pct < 5) return ', stable vs semaine précédente';
  return `, ${report.deltaRatio > 0 ? '▲' : '▼'} ${pct}\u00a0% vs semaine précédente`;
}

/** Discord embed for a weekly report. Pure: no I/O. */
export function buildWeeklyRecapEmbed(report: UsageReport): DiscordEmbed {
  const { totals, month } = report;
  const lines = [
    `**Semaine** : ${formatUsdFr(totals.costUsd)} · ${formatInt(totals.calls)} appel${totals.calls > 1 ? 's' : ''}${deltaText(report)}`,
    `**${month.label.charAt(0).toUpperCase()}${month.label.slice(1)}** : ${formatUsdFr(month.spentUsd)} sur ${formatUsdFr(month.budgetUsd)} (${formatPct(month.budgetRatio)} du budget)` +
      (month.complete ? '' : ` · fin de mois ≈ ${formatUsdFr(month.projectedUsd)}`),
    `**Coût moyen** : ${formatUsdFr(totals.avgCostPerDay)} / jour · ${totals.avgCostPerCall === null ? '—' : formatUsdFr(totals.avgCostPerCall)} / appel`,
  ];
  if (totals.cacheRate !== null) {
    lines.push(
      `**Cache** : ${formatPct(totals.cacheRate)} des tokens d'entrée · ~${formatUsdFr(report.cacheSavingsUsd)} économisés`,
    );
  }
  const insight = report.insights.find((i) => i.id !== 'projection' && i.id !== 'trend');
  if (insight) lines.push('', `💡 ${insight.text}`);
  return {
    title: `📊 Dépenses IA — ${report.range.label}`,
    description: lines.join('\n'),
    color: LEVEL_COLORS[month.projectedLevel],
    footer: { text: 'Estimation aux prix catalogue · détail : page « Dépenses IA »' },
  };
}

export type WeeklyRecapStatus =
  | 'disabled'
  | 'not_anthropic'
  | 'no_usage'
  | 'no_webhook'
  | 'already_sent'
  | 'sent'
  | 'failed';

export interface WeeklyRecapDeps {
  now?: number;
  notify?: (webhookUrl: string, embed: DiscordEmbed) => Promise<unknown>;
}

export async function sendWeeklyRecap(
  config: UsageReportConfig,
  deps: WeeklyRecapDeps = {},
): Promise<WeeklyRecapStatus> {
  if (!isWeeklyRecapEnabled(config)) return 'disabled';
  const now = deps.now ?? Date.now();
  const range = previousWeekRange(now);
  const report = buildUsageReport(config, range, { now });
  if (!report.enforced) return 'not_anthropic';
  if (report.totals.calls === 0) return 'no_usage';
  const webhook = resolveAlertWebhook(config);
  if (!webhook) {
    logger.warn('AI weekly recap skipped: no Discord webhook configured');
    return 'no_webhook';
  }
  const db = getDb();
  const claimed = db
    .prepare(`INSERT OR IGNORE INTO ai_usage_recaps (week, status, created_at) VALUES (?, 'sending', ?)`)
    .run(range.from, now);
  if (claimed.changes === 0) return 'already_sent';

  const embed = buildWeeklyRecapEmbed(report);
  const notify = deps.notify ?? ((url: string, e: DiscordEmbed) => sendDiscordEmbeds(url, [e]));
  let status: WeeklyRecapStatus = 'sent';
  try {
    const result = (await notify(webhook, embed)) as { success?: boolean } | undefined;
    if (result && result.success === false) status = 'failed';
  } catch (err) {
    status = 'failed';
    logger.warn('AI weekly recap not delivered', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  db.prepare('UPDATE ai_usage_recaps SET status = ? WHERE week = ?').run(status, range.from);
  return status;
}
