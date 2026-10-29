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
import {
  resolveAiProvider,
  resolveAiSelection,
  type AiModelSettings,
  type AiProvider,
  type AiSelection,
} from './models.js';
import { readAiModelSettings } from './settings.js';
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
export { resolveAiProvider, resolveAiModel, resolveAiSelection } from './models.js';
export type { AiProvider, AiSelection } from './models.js';

export function isAiConfigured(config: Config): boolean {
  return resolveAiProvider(config) === 'anthropic'
    ? Boolean(config.ANTHROPIC_API_KEY)
    : Boolean(githubModelsApiKey(config));
}

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
  afterUsage?: (usage: AiCallUsage) => void;
  assertBudget?: (provider: AiProvider, task: AiTask) => void;
  aiSettings?: () => AiModelSettings;
}

export function createAi(config: Config, deps: CreateAiDeps = {}): AiPort {
  const provider = resolveAiProvider(config);
  const readSettings = deps.aiSettings ?? readAiModelSettings;
  const selectionFor = (task: AiTask): AiSelection =>
    resolveAiSelection(config, readSettings(), provider, AI_TASKS[task].tier);
  const modelFor = (task: AiTask) => selectionFor(task).model;

  const record = (usage: AiCallUsage) => {
    try {
      (deps.recordUsage ?? recordAiUsage)(usage);
    } catch (err) {
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
      const selection = selectionFor(req.task);
      return call(
        selection.model,
        req,
        (r) => {
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
        },
        selection.effort,
      );
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
