import { logger } from '../logger.js';

const DISCORD_MAX_CONTENT = 2000;
const DISCORD_MAX_EMBED_DESC = 4096;

export const DISCORD_LIMITS = {
  content: DISCORD_MAX_CONTENT,
  embedsPerMessage: 10,
  totalEmbedChars: 6000,
  embedTitle: 256,
  embedDescription: DISCORD_MAX_EMBED_DESC,
  embedFooter: 2048,
} as const;

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordMessage {
  content?: string;
  embeds: DiscordEmbed[];
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

export function sanitize(text: string): string {
  return text
    .replace(/@everyone/gi, '@\u200Beveryone')
    .replace(/@here/gi, '@\u200Bhere')
    .replace(/<@[!&]?\d+>/g, '[mention]');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function formatDiscordPayload(summary: string, runId: number): DiscordPayload {
  const safe = sanitize(summary);

  return {
    embeds: [
      {
        title: 'Veille IA & Tech quotidienne',
        description: truncate(safe, DISCORD_MAX_EMBED_DESC),
        color: 0x1d9bf0,
        footer: { text: `Run #${runId}` },
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function postDiscordPayload(webhookUrl: string, payload: DiscordPayload): Promise<NotifyResult> {
  const doSend = async (): Promise<Response> => {
    return fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  try {
    let response = await doSend();

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') || '5');
      const waitMs = Math.min(retryAfter * 1000, 30_000);
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

    return { success: true };
  } catch (err) {
    const error = `Discord webhook error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(error);
    return { success: false, error };
  }
}

export async function sendDiscordNotification(
  webhookUrl: string,
  summary: string,
  runId: number,
): Promise<NotifyResult> {
  const result = await postDiscordPayload(webhookUrl, formatDiscordPayload(summary, runId));
  if (result.success) {
    logger.info('Discord notification sent', { runId });
  }
  return result;
}

export async function sendDiscordEmbeds(
  webhookUrl: string,
  embeds: DiscordEmbed[],
): Promise<NotifyResult> {
  const safeEmbeds = embeds.slice(0, 10).map((e) => ({
    ...e,
    ...(e.title ? { title: truncate(sanitize(e.title), 256) } : {}),
    ...(e.description ? { description: truncate(sanitize(e.description), DISCORD_MAX_EMBED_DESC) } : {}),
  }));
  return postDiscordPayload(webhookUrl, { embeds: safeEmbeds, allowed_mentions: { parse: [] } });
}

export async function sendDiscordMessage(
  webhookUrl: string,
  message: DiscordMessage,
): Promise<NotifyResult> {
  const embeds = message.embeds.slice(0, DISCORD_LIMITS.embedsPerMessage).map((e) => ({
    ...e,
    ...(e.title ? { title: truncate(sanitize(e.title), DISCORD_LIMITS.embedTitle) } : {}),
    ...(e.description
      ? { description: truncate(sanitize(e.description), DISCORD_MAX_EMBED_DESC) }
      : {}),
  }));
  return postDiscordPayload(webhookUrl, {
    ...(message.content ? { content: truncate(sanitize(message.content), DISCORD_MAX_CONTENT) } : {}),
    embeds,
    allowed_mentions: { parse: [] },
  });
}

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
