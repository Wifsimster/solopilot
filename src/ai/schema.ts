/**
 * Tiny JSON Schema builders for structured-output contracts (ADR-0027).
 * Every object property is required and closed (`additionalProperties: false`),
 * as structured outputs expect. Bounds (min/max) are hints: the SDK moves
 * unsupported keywords into the description, and callers keep validating with
 * their Zod schema. The SDK helper also turns `enum` into a description hint.
 */
import type { JsonObjectSchema } from './port.js';

type Schema = Record<string, unknown>;

export const str = (bounds: { minLength?: number; maxLength?: number } = {}): Schema => ({
  type: 'string',
  ...bounds,
});
export const int = (minimum: number, maximum: number): Schema => ({
  type: 'integer',
  minimum,
  maximum,
});
export const num = (minimum: number, maximum: number): Schema => ({
  type: 'number',
  minimum,
  maximum,
});
export const bool = (): Schema => ({ type: 'boolean' });
export const enumOf = (values: readonly string[]): Schema => ({
  type: 'string',
  enum: [...values],
});
export const arr = (
  items: Schema,
  bounds: { minItems?: number; maxItems?: number } = {},
): Schema => ({
  type: 'array',
  items,
  ...bounds,
});
export function obj(properties: Record<string, Schema>): JsonObjectSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
