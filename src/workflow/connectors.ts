/**
 * Connector registry builder.
 *
 * Phase 1 wires the Discord connector by delegating to the existing notifier,
 * so workflow steps reach external systems through one typed surface. Email,
 * Stripe and Calendar connectors are added here as their modules come online.
 */
import type { Config } from '../config.js';
import { sendDiscordNotification } from '../adapters/discord-notifier.js';
import { createStripeConnector } from '../connectors/stripe.js';
import { createCalendarConnector } from '../connectors/calendar.js';
import type { ConnectorRegistry } from './types.js';

export function buildConnectors(config: Config): ConnectorRegistry {
  return {
    discord: {
      send: async (webhookUrl: string, content: string) => {
        // runId 0 — ad-hoc workflow notification, not tied to a legacy `runs` row.
        const result = await sendDiscordNotification(webhookUrl, content, 0);
        return { success: result.success, error: result.error };
      },
    },
    stripe: createStripeConnector(config),
    calendar: createCalendarConnector(config),
  };
}
