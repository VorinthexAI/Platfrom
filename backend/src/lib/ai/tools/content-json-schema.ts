import type { z } from 'zod';

export type ContentJsonSchema = Record<string, unknown>;

/** Converts the Zod constructs used by Content contracts into provider-neutral JSON Schema metadata. */
export function contentZodToJsonSchema(schema: z.ZodTypeAny): ContentJsonSchema {
  const definition = schema._def as Record<string, any>;
  const typeName = definition.typeName as string;
  const described = (output: ContentJsonSchema) => typeof definition.description === 'string' ? { ...output, description: definition.description } : output;
  if (typeName === 'ZodOptional') return described(contentZodToJsonSchema(definition.innerType));
  if (typeName === 'ZodDefault') return described({ ...contentZodToJsonSchema(definition.innerType), default: definition.defaultValue() });
  if (typeName === 'ZodEffects') return described(contentZodToJsonSchema(definition.schema));
  if (typeName === 'ZodPipeline') return described(contentZodToJsonSchema(definition.out));
  if (typeName === 'ZodLazy') return { type: 'object' };
  if (typeName === 'ZodString') {
    const output: ContentJsonSchema = { type: 'string' };
    for (const check of definition.checks ?? []) {
      if (check.kind === 'min') output.minLength = check.value;
      if (check.kind === 'max') output.maxLength = check.value;
      if (check.kind === 'datetime') output.format = 'date-time';
      if (check.kind === 'url') output.format = 'uri';
    }
    return described(output);
  }
  if (typeName === 'ZodNumber') {
    const output: ContentJsonSchema = { type: definition.checks?.some((check: any) => check.kind === 'int') ? 'integer' : 'number' };
    if (typeof definition.description === 'string') output.description = definition.description;
    for (const check of definition.checks ?? []) {
      if (check.kind === 'min') output[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
      if (check.kind === 'max') output[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
    }
    return described(output);
  }
  if (typeName === 'ZodBoolean') return described({ type: 'boolean' });
  if (typeName === 'ZodLiteral') return described({ const: definition.value });
  if (typeName === 'ZodEnum') return described({ type: 'string', enum: [...definition.values] });
  if (typeName === 'ZodArray') {
    const output: ContentJsonSchema = { type: 'array', items: contentZodToJsonSchema(definition.type) };
    if (definition.minLength) output.minItems = definition.minLength.value;
    if (definition.maxLength) output.maxItems = definition.maxLength.value;
    return described(output);
  }
  if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
    const options = typeName === 'ZodUnion' ? definition.options : [...definition.options.values()];
    return described({ oneOf: options.map(contentZodToJsonSchema) });
  }
  if (typeName === 'ZodRecord') return described({ type: 'object', additionalProperties: contentZodToJsonSchema(definition.valueType) });
  if (typeName === 'ZodObject') {
    const shape = definition.shape();
    const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, contentZodToJsonSchema(value as z.ZodTypeAny)]));
    const required = Object.entries(shape).filter(([, value]) => !(value as z.ZodTypeAny).isOptional()).map(([key]) => key);
    return described({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
  }
  return {};
}
