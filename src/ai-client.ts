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

/**
 * Whether the configured provider accepts OpenAI's
 * `response_format: {type: 'json_object'}` JSON mode. Anthropic's
 * OpenAI-compatible endpoint rejects it (it only accepts `json_schema`), so we
 * omit the field there and rely on the prompt's explicit "reply in JSON"
 * instruction instead.
 */
export function supportsJsonObjectMode(config: Config): boolean {
  return !config.AI_BASE_URL.includes('api.anthropic.com');
}

/**
 * Spread-in `response_format` params for a chat completion, included only when
 * the provider supports OpenAI JSON mode. Use as `...jsonModeParams(config)`.
 */
export function jsonModeParams(config: Config): { response_format?: { type: 'json_object' } } {
  return supportsJsonObjectMode(config) ? { response_format: { type: 'json_object' } } : {};
}

/**
 * Parse a JSON object/array from a model response, tolerating Markdown code
 * fences (```json … ```) and surrounding prose. Providers without JSON mode
 * (e.g. Anthropic) occasionally wrap JSON in a fence even when instructed not to.
 */
export function parseJsonResponse(raw: string): unknown {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) s = fenced[1].trim();
  try {
    return JSON.parse(s);
  } catch (err) {
    const span = s.match(/[[{][\s\S]*[\]}]/);
    if (span) {
      return JSON.parse(span[0]);
    }
    throw err;
  }
}
