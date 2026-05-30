import { logger } from '../logger.js';

const DISCORD_MAX_CONTENT = 2000;
const DISCORD_MAX_EMBED_DESC = 4096;

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions: { parse: [] };
}

export interface NotifyResult {
  success: boolean;
  error?: string;
}

/**
 * Sanitize text to prevent Discord mention injection (@everyone, @here, role/user mentions).
 */
function sanitize(text: string): string {
  return text
    .replace(/@everyone/gi, '@\u200Beveryone')
    .replace(/@here/gi, '@\u200Bhere')
    .replace(/<@[!&]?\d+>/g, '[mention]');
}

/**
 * Truncate text to a maximum length, adding an ellipsis marker if truncated.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * Format a run summary as a Discord embed payload.
 */
function formatDiscordPayload(summary: string, runId: number): DiscordPayload {
  const safe = sanitize(summary);

  return {
    embeds: [
      {
        title: 'Veille IA & Tech quotidienne',
        description: truncate(safe, DISCORD_MAX_EMBED_DESC),
        color: 0x1d9bf0, // X/Twitter blue
        footer: { text: `Run #${runId}` },
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/**
 * Send a notification to a Discord webhook.
 * Retries once on HTTP 429 (rate limit) using the Retry-After header.
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  summary: string,
  runId: number,
): Promise<NotifyResult> {
  const payload = formatDiscordPayload(summary, runId);

  const doSend = async (): Promise<Response> => {
    return fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  try {
    let response = await doSend();

    // Retry once on rate limit
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') || '5');
      const waitMs = Math.min(retryAfter * 1000, 30_000); // Cap at 30s
      logger.warn('Discord rate limited, retrying', { retryAfterMs: waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      response = await doSend();
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = `Discord webhook failed: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`;
      logger.error(error);
      return { success: false, error };
    }

    logger.info('Discord notification sent', { runId });
    return { success: true };
  } catch (err) {
    const error = `Discord webhook error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(error);
    return { success: false, error };
  }
}

/**
 * Send a test message to verify webhook configuration.
 */
export async function testDiscordWebhook(webhookUrl: string): Promise<NotifyResult> {
  const payload: DiscordPayload = {
    content: truncate(
      'Test de connexion depuis X AI Daily Bot. Si vous voyez ce message, le webhook est correctement configure.',
      DISCORD_MAX_CONTENT,
    ),
    allowed_mentions: { parse: [] },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        success: false,
        error: `HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
