import OpenAI from 'openai';
import type { Config } from './config.js';

/**
 * Resolve the API key used to authenticate against the AI inference endpoint.
 *
 * Prefers `AI_API_KEY` (OpenRouter or any OpenAI-compatible provider) and falls
 * back to `GITHUB_TOKEN` so existing GitHub Models setups keep working with no
 * config change.
 */
export function resolveAiApiKey(config: Config): string | undefined {
  return config.AI_API_KEY ?? config.GITHUB_TOKEN;
}

/**
 * Build an OpenAI-compatible client pointed at the configured AI provider.
 *
 * Defaults to GitHub Models (`AI_BASE_URL` default). To use OpenRouter, set
 * `AI_BASE_URL=https://openrouter.ai/api/v1`, `AI_API_KEY=sk-or-...` and pick an
 * `AI_MODEL` OpenRouter exposes (e.g. `openai/gpt-4.1`, `anthropic/claude-3.5-sonnet`).
 */
export function createAiClient(config: Config, options?: { timeout?: number }): OpenAI {
  const apiKey = resolveAiApiKey(config);
  if (!apiKey) {
    throw new Error('Client AI indisponible : aucune clé (AI_API_KEY ou GITHUB_TOKEN).');
  }

  const isOpenRouter = config.AI_BASE_URL.includes('openrouter.ai');

  return new OpenAI({
    baseURL: config.AI_BASE_URL,
    apiKey,
    ...(options?.timeout ? { timeout: options.timeout } : {}),
    // OpenRouter uses these optional headers for attribution / rankings.
    ...(isOpenRouter && {
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/Wifsimster/solopilot',
        'X-Title': 'Solopilot',
      },
    }),
  });
}
