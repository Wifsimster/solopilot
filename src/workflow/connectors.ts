import type { Config } from '../config.js';
import { sendDiscordNotification } from '../adapters/discord-notifier.js';
import { createStripeConnector } from '../connectors/stripe.js';
import { createCalendarConnector } from '../connectors/calendar.js';
import { createGithubIssuesConnector } from '../connectors/github-issues.js';
import type { ConnectorRegistry } from './types.js';

export function buildConnectors(config: Config): ConnectorRegistry {
  return {
    discord: {
      send: async (webhookUrl: string, content: string) => {
        const result = await sendDiscordNotification(webhookUrl, content, 0);
        return { success: result.success, error: result.error };
      },
    },
    stripe: createStripeConnector(config),
    calendar: createCalendarConnector(config),
    githubIssues: createGithubIssuesConnector(config),
  };
}
