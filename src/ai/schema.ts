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
