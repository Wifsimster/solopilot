/**
 * GitHub Models / OpenAI-compatible adapter of the AI port (ADR-0027): the
 * historical behaviour, unchanged (chat.completions + JSON mode where the
 * endpoint supports it). Kept as the rollback path (`AI_PROVIDER=github-models`).
 */
import OpenAI from 'openai';
import type { Config } from '../config.js';
import { AiError } from './errors.js';
import type { TokenUsage } from './models.js';
import type { AiJsonRequest, AiRequest } from './port.js';

export function githubModelsApiKey(
  config: Pick<Config, 'AI_API_KEY' | 'GITHUB_TOKEN'>,
): string | undefined {
  return config.AI_API_KEY ?? config.GITHUB_TOKEN;
}

export function createOpenAiClient(config: Config): OpenAI {
  const apiKey = githubModelsApiKey(config);
  if (!apiKey) {
    throw new AiError(
      'not_configured',
      'Client AI indisponible : aucune clé (AI_API_KEY ou GITHUB_TOKEN).',
    );
  }
  const isOpenRouter = config.AI_BASE_URL.includes('openrouter.ai');
  return new OpenAI({
    baseURL: config.AI_BASE_URL,
    apiKey,
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
 * Whether the endpoint accepts `response_format: {type: 'json_object'}`.
 * Anthropic's OpenAI-compatible endpoint rejects it.
 */
export function supportsJsonObjectMode(config: Pick<Config, 'AI_BASE_URL'>): boolean {
  return !config.AI_BASE_URL.includes('api.anthropic.com');
}

/**
 * Parse a JSON object/array from a model response, tolerating Markdown code
 * fences and surrounding prose (no constrained decoding on this path).
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

export interface OpenAiCallResult {
  text: string;
  model: string;
  stopReason: string | null;
  usage: TokenUsage;
}

export function createGithubModelsCaller(config: Config, client: OpenAI) {
  return async function call(
    model: string,
    req: AiRequest | AiJsonRequest,
  ): Promise<OpenAiCallResult> {
    const json = 'schema' in req;
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: req.maxTokens,
        ...(json && supportsJsonObjectMode(config)
          ? { response_format: { type: 'json_object' as const } }
          : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      },
      { timeout: req.timeoutMs },
    );
    return {
      text: (response.choices[0]?.message?.content ?? '').trim(),
      model: response.model || model,
      stopReason: response.choices[0]?.finish_reason ?? null,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
  };
}
