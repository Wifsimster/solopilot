/**
 * HTTP routes of the « Dépenses IA » page. Registered by `server.ts`; kept in
 * their own module so tests can mount them on a bare Hono app.
 *
 * - GET /api/ai/usage/report?period=7d|30d|month|prev-month|12m
 * - PUT /api/ai/usage/recap  { "enabled": boolean }
 *
 * Responses carry aggregates only: no prompt, answer or key.
 */
import type { Hono } from 'hono';
import { setSetting } from '../settings-service.js';
import { resolveAlertWebhook } from './usage.js';
import {
  buildUsageReport,
  recapSettingSchema,
  resolveUsageRange,
  usageReportQuerySchema,
  type UsageReportConfig,
} from './usage-report.js';

export interface UsageReportRouteOptions {
  now?: () => number;
}

function invalid(issues: { path: (string | number)[]; message: string }[]) {
  return {
    success: false,
    message: issues[0]?.message ?? 'Paramètres invalides.',
    issues: issues.map((i) => ({ path: i.path, message: i.message })),
  };
}

export function registerAiUsageReportRoutes(
  app: Hono,
  getConfig: () => UsageReportConfig,
  options: UsageReportRouteOptions = {},
): void {
  app.get('/api/ai/usage/report', (c) => {
    const parsed = usageReportQuerySchema.safeParse({ period: c.req.query('period') });
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const config = getConfig();
    const now = options.now?.() ?? Date.now();
    const report = buildUsageReport(config, resolveUsageRange(parsed.data.period, now), {
      now,
      webhookConfigured: resolveAlertWebhook(config) !== undefined,
    });
    return c.json(report);
  });

  app.put('/api/ai/usage/recap', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, message: 'Corps JSON invalide.' }, 400);
    }
    const parsed = recapSettingSchema.safeParse(body);
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    setSetting('AI_WEEKLY_RECAP_ENABLED', parsed.data.enabled ? 'true' : 'false');
    return c.json({
      success: true,
      enabled: parsed.data.enabled,
      message: parsed.data.enabled
        ? 'Récap hebdomadaire activé (lundi 9:00).'
        : 'Récap hebdomadaire désactivé.',
    });
  });
}
