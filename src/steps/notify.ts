/**
 * `notify.discord` step.
 *
 * Sends a message through the Discord connector. The webhook is taken from the
 * step input or the activity config; the content from the input (`content` or
 * `summary`). Degradable: a missing webhook or a failed send is recorded as a
 * skipped step, never failing the whole run (ADR-0013, graceful degradation).
 */
import type { Step } from '../workflow/types.js';

interface NotifyInput {
  webhookUrl?: string;
  content?: string;
  summary?: string;
}

export interface NotifyOutput {
  notified: boolean;
  reason?: string;
}

export const notifyDiscordStep: Step<NotifyOutput> = {
  use: 'notify.discord',
  degradable: true,
  run: async (ctx, rawInput) => {
    const input = rawInput as NotifyInput;
    const webhookUrl = input.webhookUrl ?? ctx.config.DISCORD_WEBHOOK_URL;
    const content = input.content ?? input.summary;

    if (!webhookUrl) {
      ctx.log.info('notify.discord skipped — no webhook configured', { activity: ctx.activityId });
      return { notified: false, reason: 'no_webhook' };
    }
    if (!content) {
      ctx.log.info('notify.discord skipped — nothing to send', { activity: ctx.activityId });
      return { notified: false, reason: 'no_content' };
    }

    const result = await ctx.connectors.discord.send(webhookUrl, content);
    return { notified: result.success, reason: result.error };
  },
};
