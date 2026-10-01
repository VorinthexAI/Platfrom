import { z } from 'zod';
import { contentToolContracts, validateCreationDateRange, type ContentToolName } from './content-schemas';
import { contentZodToJsonSchema } from './content-json-schema';

export const CONTENT_TOOL_NAMES = Object.freeze(Object.keys(contentToolContracts) as ContentToolName[]);
export const contentToolNameSchema = z.enum(CONTENT_TOOL_NAMES as [ContentToolName, ...ContentToolName[]]);

export const contentToolInputSchemas = Object.fromEntries(
  CONTENT_TOOL_NAMES.map((name) => [name, contentToolContracts[name].input]),
) as { [Name in ContentToolName]: (typeof contentToolContracts)[Name]['input'] };

export const contentToolOutputSchemas = Object.fromEntries(
  CONTENT_TOOL_NAMES.map((name) => [name, contentToolContracts[name].output]),
) as { [Name in ContentToolName]: (typeof contentToolContracts)[Name]['output'] };

const PRIMARY_SCOPE_TOOLS = new Set<ContentToolName>(['folder.list', 'folder.create', 'file.list', 'content.search', 'content.search-history.record', 'content.search-history.list', 'content.search-history.delete', 'tag.list', 'tag.create', 'tag.assignment.list', 'tag.assignment.set']);

export function hasPrimaryModelScope(name: ContentToolName) {
  return PRIMARY_SCOPE_TOOLS.has(name);
}

export function hasContentIdempotencyKey(name: ContentToolName) {
  let schema: z.ZodTypeAny = contentToolContracts[name].input;
  while (schema instanceof z.ZodEffects) schema = schema.innerType();
  return schema instanceof z.ZodObject && Object.prototype.hasOwnProperty.call(schema.shape, 'idempotencyKey');
}

function modelInputSchema(name: ContentToolName): z.ZodTypeAny {
  if (name === 'folder.create') {
    const canonical = contentToolContracts[name].input;
    const folder = canonical.shape.folders.element.omit({ scopeKey: true });
    return canonical.extend({ folders: z.array(folder).min(1).max(100) }).omit({ scopeKey: true });
  }
  if (hasPrimaryModelScope(name)) {
    const canonical: z.ZodTypeAny = contentToolContracts[name].input;
    const object = canonical instanceof z.ZodEffects ? canonical.innerType() : canonical;
    const model = (object as z.AnyZodObject).omit({ scopeKey: true });
    return name === 'folder.list' || name === 'file.list' ? model.superRefine((value, context) => validateCreationDateRange(value, context)) : model;
  }
  return contentToolContracts[name].input;
}

export const contentToolModelInputSchemas = Object.fromEntries(
  CONTENT_TOOL_NAMES.map((name) => [name, modelInputSchema(name)]),
) as Record<ContentToolName, z.ZodTypeAny>;

function providerInputSchema(name: ContentToolName) {
  return contentZodToJsonSchema(contentToolModelInputSchemas[name]);
}

export const CONTENT_TOOL_DEFINITIONS = Object.freeze(CONTENT_TOOL_NAMES.map((name) => Object.freeze({
  name,
  description: contentToolContracts[name].description,
  inputSchema: providerInputSchema(name),
  outputSchema: contentZodToJsonSchema(contentToolContracts[name].output),
})));

export function isContentToolName(value: string): value is ContentToolName {
  return Object.prototype.hasOwnProperty.call(contentToolContracts, value);
}
