/**
 * AI port factory (ADR-0027). `createAi(config)` picks the adapter from
 * `AI_PROVIDER` / `ANTHROPIC_API_KEY`, records usage and enforces the monthly
 * budget. Business code only sees `AiPort`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import {
  ANTHROPIC_MAX_RETRIES,
  createAnthropicCaller,
  parseStructuredOutput,
  type AnthropicMessagesClient,
} from './anthropic-adapter.js';
import { AiError } from './errors.js';
import {
  createGithubModelsCaller,
  createOpenAiClient,
  githubModelsApiKey,
  parseJsonResponse,
} from './github-models-adapter.js';
import { resolveAiModel, resolveAiProvider, type AiProvider } from './models.js';
import {
  AI_TASKS,
  type AiCallUsage,
  type AiPort,
  type AiTask,
  type AiUsageRecorder,
} from './port.js';
import { assertWithinBudget, checkBudgetAlerts, recordAiUsage } from './usage.js';

export { AiError } from './errors.js';
export type { AiErrorCode } from './errors.js';
export { AI_TASKS } from './port.js';
export type { AiPort, AiTask, AiRequest, AiJsonRequest, JsonObjectSchema } from './port.js';
export { resolveAiProvider, resolveAiModel } from './models.js';
export type { AiProvider } from './models.js';

/** Whether the active provider has its credential. */
export function isAiConfigured(config: Config): boolean {
  return resolveAiProvider(config) === 'anthropic'
    ? Boolean(config.ANTHROPIC_API_KEY)
    : Boolean(githubModelsApiKey(config));
}

/** French "missing key" message for the active provider. */
export function aiNotConfiguredMessage(config: Config): string {
  return resolveAiProvider(config) === 'anthropic'
    ? 'Client AI indisponible : clé ANTHROPIC_API_KEY manquante.'
    : 'Client AI indisponible : clé AI (AI_API_KEY ou GITHUB_TOKEN) manquante.';
}

export function createAnthropicClient(
  config: Config,
  opts: { fetch?: typeof fetch } = {},
): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new AiError(
      'not_configured',
      'Client AI indisponible : clé ANTHROPIC_API_KEY manquante.',
    );
  }
  // Key from the validated config (env only, never the DB).
  return new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
    maxRetries: ANTHROPIC_MAX_RETRIES,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export interface CreateAiDeps {
  anthropicClient?: AnthropicMessagesClient;
  openaiClient?: OpenAI;
  recordUsage?: AiUsageRecorder;
  /** Post-record hook (budget alerts). Defaults to Discord/log alerts at 80 % / 100 %. */
  afterUsage?: (usage: AiCallUsage) => void;
  /** Budget check; defaults to the SQLite ledger. */
  assertBudget?: (provider: AiProvider, task: AiTask) => void;
}

export function createAi(config: Config, deps: CreateAiDeps = {}): AiPort {
  const provider = resolveAiProvider(config);
  const modelFor = (task: AiTask) => resolveAiModel(config, provider, AI_TASKS[task].tier);

  const record = (usage: AiCallUsage) => {
    try {
      (deps.recordUsage ?? recordAiUsage)(usage);
    } catch (err) {
      // Accounting must never break a business call.
      logger.warn('AI usage not recorded', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (deps.afterUsage) {
      deps.afterUsage(usage);
    } else if (provider === 'anthropic') {
      void checkBudgetAlerts(config).catch((err: unknown) =>
        logger.warn('AI budget check failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };
  const assertBudget =
    deps.assertBudget ?? ((p: AiProvider, task: AiTask) => assertWithinBudget(config, p, task));

  const logUsage = (usage: AiCallUsage) =>
    logger.info('AI usage', {
      provider: usage.provider,
      task: usage.task,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      stopReason: usage.stopReason,
      costUsd: usage.costUsd,
    });

  if (provider === 'anthropic') {
    const call = createAnthropicCaller(deps.anthropicClient ?? createAnthropicClient(config));
    const run = async (req: Parameters<AiPort['text']>[0]) => {
      assertBudget(provider, req.task);
      return call(modelFor(req.task), req, (r) => {
        const usage: AiCallUsage = {
          provider,
          model: r.model,
          task: req.task,
          stopReason: r.stopReason,
          costUsd: r.costUsd,
          ...r.usage,
        };
        logUsage(usage);
        record(usage);
      });
    };
    return {
      provider,
      modelFor,
      async text(req) {
        return (await run(req)).text;
      },
      async json(req) {
        const result = await run(req);
        return parseStructuredOutput(req.task, result.text);
      },
    };
  }

  const call = createGithubModelsCaller(config, deps.openaiClient ?? createOpenAiClient(config));
  const run = async (req: Parameters<AiPort['text']>[0]) => {
    const result = await call(modelFor(req.task), req);
    const usage: AiCallUsage = {
      provider,
      model: result.model,
      task: req.task,
      stopReason: result.stopReason,
      costUsd: 0,
      ...result.usage,
    };
    logUsage(usage);
    record(usage);
    return result;
  };
  return {
    provider,
    modelFor,
    async text(req) {
      return (await run(req)).text;
    },
    async json(req) {
      const result = await run(req);
      try {
        return parseJsonResponse(result.text);
      } catch (err) {
        throw new AiError(
          'invalid_output',
          `Reponse AI non-JSON (${req.task}) : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
