/**
 * Provider-neutral AI errors (ADR-0027). Messages are French: call sites
 * persist / display `err.message` as-is.
 */
export type AiErrorCode =
  | 'not_configured'
  | 'budget_exceeded'
  | 'refusal'
  | 'truncated'
  | 'invalid_output'
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'bad_request'
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'connection'
  | 'api';

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** Whether a later retry (next cron tick, manual retry) may succeed. */
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: AiErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AiError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}
