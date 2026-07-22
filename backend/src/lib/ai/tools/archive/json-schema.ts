import type { z } from 'zod';

export type ArchiveJsonSchema = Record<string, unknown>;

/** Converts the Zod constructs used by Archive contracts into provider-neutral JSON Schema metadata. */
export function archiveZodToJsonSchema(schema: z.ZodTypeAny): ArchiveJsonSchema {
  const definition = schema._def as Record<string, any>;
  const typeName = definition.typeName as string;
  if (typeName === 'ZodOptional') return archiveZodToJsonSchema(definition.innerType);
  if (typeName === 'ZodDefault') return { ...archiveZodToJsonSchema(definition.innerType), default: definition.defaultValue() };
  if (typeName === 'ZodEffects') return archiveZodToJsonSchema(definition.schema);
  if (typeName === 'ZodLazy') return { type: 'object' };
  if (typeName === 'ZodString') {
    const output: ArchiveJsonSchema = { type: 'string' };
    for (const check of definition.checks ?? []) {
      if (check.kind === 'min') output.minLength = check.value;
      if (check.kind === 'max') output.maxLength = check.value;
      if (check.kind === 'datetime') output.format = 'date-time';
      if (check.kind === 'url') output.format = 'uri';
    }
    return output;
  }
  if (typeName === 'ZodNumber') {
    const output: ArchiveJsonSchema = { type: definition.checks?.some((check: any) => check.kind === 'int') ? 'integer' : 'number' };
    for (const check of definition.checks ?? []) {
      if (check.kind === 'min') output[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
      if (check.kind === 'max') output[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
    }
    return output;
  }
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodLiteral') return { const: definition.value };
  if (typeName === 'ZodEnum') return { type: 'string', enum: [...definition.values] };
  if (typeName === 'ZodArray') {
    const output: ArchiveJsonSchema = { type: 'array', items: archiveZodToJsonSchema(definition.type) };
    if (definition.minLength) output.minItems = definition.minLength.value;
    if (definition.maxLength) output.maxItems = definition.maxLength.value;
    return output;
  }
  if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
    const options = typeName === 'ZodUnion' ? definition.options : [...definition.options.values()];
    return { oneOf: options.map(archiveZodToJsonSchema) };
  }
  if (typeName === 'ZodRecord') return { type: 'object', additionalProperties: archiveZodToJsonSchema(definition.valueType) };
  if (typeName === 'ZodObject') {
    const shape = definition.shape();
    const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, archiveZodToJsonSchema(value as z.ZodTypeAny)]));
    const required = Object.entries(shape).filter(([, value]) => !(value as z.ZodTypeAny).isOptional()).map(([key]) => key);
    return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
  }
  return {};
}
