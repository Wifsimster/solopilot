/**
 * Anthropic adapter of the AI port (ADR-0027), on the official
 * `@anthropic-ai/sdk`.
 *
 * - Structured JSON via `output_config.format` (json_schema), never prefill.
 * - Effort / adaptive thinking per task profile (or the class's effort from
 *   Settings), gated by the model catalogue in `models.ts`.
 * - Server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`)
 *   only on models that support it (Sonnet 5.5, Opus 5.x, Fable): never on
 *   Claude Haiku 5.5, the default, which has no server-side fallback. The
 *   parameter only exists on the beta Messages surface, hence
 *   `client.beta.messages.create` (without `betas` when no fallback is sent).
 *   `stop_reason: "refusal"` is always checked before reading content.
 * - Retries: the SDK retries 429 / 5xx / connection errors itself
 *   (`maxRetries`); what is left is mapped to a typed `AiError`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { AiError } from './errors.js';
import {
  anthropicCapabilities,
  estimateCostUsd,
  type AiEffort,
  type TokenUsage,
} from './models.js';
import {
  AI_TASKS,
  type AiJsonRequest,
  type AiProfile,
  type AiRequest,
  type AiTask,
} from './port.js';

export const ANTHROPIC_MAX_RETRIES = 2;
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Minimal client surface used here (lets tests inject a fake). */
export interface AnthropicMessagesClient {
  beta: {
    messages: {
      create(
        params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        options?: { timeout?: number },
      ): PromiseLike<Anthropic.Beta.Messages.BetaMessage>;
    };
  };
}

/** Per-task effort when the class has no effort override. */
const EFFORT: Record<AiProfile, AiEffort> = {
  classify: 'low',
  generate: 'medium',
  report: 'high',
};

/** Extra max_tokens on thinking-capable models: thinking tokens count against it. */
const THINKING_HEADROOM: Record<AiProfile, number> = {
  classify: 2048,
  generate: 4096,
  report: 8192,
};

/** Reasoning makes reports slower than the historical 60 s GitHub Models timeouts. */
const MIN_TIMEOUT_MS: Record<AiProfile, number> = {
  classify: 90_000,
  generate: 120_000,
  report: 300_000,
};

export interface AnthropicCallResult {
  text: string;
  model: string;
  stopReason: string | null;
  usage: TokenUsage;
  costUsd: number;
}

/**
 * Effort sent for a request: the class override when the model accepts it,
 * else the per-task default; nothing when the model has no effort parameter.
 */
export function effortFor(
  model: string,
  profile: AiProfile,
  override?: AiEffort,
): AiEffort | undefined {
  const { effortLevels } = anthropicCapabilities(model);
  if (effortLevels.length === 0) return undefined;
  if (override && effortLevels.includes(override)) return override;
  return effortLevels.includes(EFFORT[profile]) ? EFFORT[profile] : undefined;
}

export function buildAnthropicParams(
  model: string,
  req: AiRequest,
  format?: ReturnType<typeof jsonSchemaOutputFormat>,
  effortOverride?: AiEffort,
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const { profile } = AI_TASKS[req.task];
  const caps = anthropicCapabilities(model);
  const effort = effortFor(model, profile, effortOverride);
  const outputConfig: Anthropic.Beta.Messages.BetaOutputConfig = {
    ...(effort ? { effort } : {}),
    ...(format ? { format: { type: format.type, schema: format.schema } } : {}),
  };
  return {
    model,
    max_tokens: req.maxTokens + (caps.adaptiveThinking ? THINKING_HEADROOM[profile] : 0),
    // Stable instructions first; the per-call payload is the only user turn.
    system: [
      {
        type: 'text',
        text: req.system,
        ...(req.cacheSystem ? { cache_control: { type: 'ephemeral' as const } } : {}),
      },
    ],
    messages: [{ role: 'user', content: req.user }],
    // Reports ask for adaptive thinking explicitly. Other profiles leave
    // `thinking` unset: Haiku 5.5 (and every 5.x model) then runs adaptive
    // thinking anyway, kept short by low/medium effort. `disabled` is never
    // sent: Opus 5.5, Sonnet 5.5 and Fable reject it, and Haiku 5.5 rejects it
    // at xhigh/max effort.
    ...(profile === 'report' && caps.adaptiveThinking
      ? { thinking: { type: 'adaptive' as const } }
      : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    ...(caps.defaultFallbacks
      ? { fallbacks: 'default' as const, betas: [SERVER_SIDE_FALLBACK_BETA] }
      : {}),
  };
}

/** SDK error -> AiError. Most specific class first (APIConnectionTimeoutError extends APIConnectionError extends APIError). */
export function mapAnthropicError(err: unknown, model: string): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'Clé ANTHROPIC_API_KEY invalide ou révoquée (401).', {
      status: 401,
      cause: err,
    });
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('permission', `Accès refusé par l'API Anthropic (403) : ${err.message}`, {
      status: 403,
      cause: err,
    });
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError(
      'not_found',
      `Modèle « ${model} » introuvable ou non disponible pour ce compte (404).`,
      {
        status: 404,
        cause: err,
      },
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError(
      'rate_limit',
      'Limite de débit Anthropic atteinte (429), malgré les nouvelles tentatives.',
      {
        status: 429,
        retryable: true,
        cause: err,
      },
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError(
      'bad_request',
      `Requête refusée par l'API Anthropic (400) : ${err.message}`,
      { status: 400, cause: err },
    );
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AiError('overloaded', `API Anthropic indisponible ou surchargée (${err.status}).`, {
      status: err.status,
      retryable: true,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('timeout', "Délai dépassé pendant l'appel à l'API Anthropic.", {
      retryable: true,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('connection', "Connexion à l'API Anthropic impossible.", {
      retryable: true,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIError) {
    // Remaining statuses, e.g. 402 billing_error, 413 request_too_large.
    return new AiError('api', `Erreur de l'API Anthropic (${err.status ?? '?'}) : ${err.message}`, {
      status: err.status,
      cause: err,
    });
  }
  return new AiError(
    'api',
    `Erreur inattendue du client Anthropic : ${err instanceof Error ? err.message : String(err)}`,
    {
      cause: err,
    },
  );
}

function readUsage(message: Anthropic.Beta.Messages.BetaMessage): TokenUsage {
  const u = message.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

export function createAnthropicCaller(client: AnthropicMessagesClient) {
  /**
   * One request. Usage is reported through `onUsage` BEFORE stop-reason checks
   * so refused / truncated calls are still accounted for.
   */
  return async function call(
    model: string,
    req: AiRequest | AiJsonRequest,
    onUsage: (result: AnthropicCallResult) => void,
    effortOverride?: AiEffort,
  ): Promise<AnthropicCallResult> {
    const format = 'schema' in req ? jsonSchemaOutputFormat(req.schema) : undefined;
    const params = buildAnthropicParams(model, req, format, effortOverride);
    const timeout = Math.max(req.timeoutMs, MIN_TIMEOUT_MS[AI_TASKS[req.task].profile]);

    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await client.beta.messages.create(params, { timeout });
    } catch (err) {
      throw mapAnthropicError(err, model);
    }

    const usage = readUsage(message);
    // `message.model` is the model that served the answer (a fallback model when one ran).
    const result: AnthropicCallResult = {
      text: message.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim(),
      model: message.model,
      stopReason: message.stop_reason,
      usage,
      costUsd: estimateCostUsd(message.model, usage),
    };
    onUsage(result);

    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category;
      throw new AiError(
        'refusal',
        `Le modèle a refusé de répondre${category ? ` (catégorie : ${category})` : ''}.`,
      );
    }
    if (message.stop_reason === 'max_tokens' && format) {
      throw new AiError('truncated', 'Réponse AI tronquée (max_tokens atteint) : JSON incomplet.', {
        retryable: true,
      });
    }
    return result;
  };
}

/** Parse a structured-output answer. Constrained decoding makes this strict JSON. */
export function parseStructuredOutput(task: AiTask, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AiError(
      'invalid_output',
      `Reponse AI non-JSON (${task}) : ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
