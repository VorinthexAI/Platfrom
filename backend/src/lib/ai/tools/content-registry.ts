import { z } from 'zod';
import { contentToolContracts, type ContentToolName } from './content-schemas';
import { contentZodToJsonSchema } from './content-json-schema';

export const CONTENT_TOOL_NAMES = Object.freeze(Object.keys(contentToolContracts) as ContentToolName[]);
export const contentToolNameSchema = z.enum(CONTENT_TOOL_NAMES as [ContentToolName, ...ContentToolName[]]);

export const contentToolInputSchemas = Object.fromEntries(
  CONTENT_TOOL_NAMES.map((name) => [name, contentToolContracts[name].input]),
) as { [Name in ContentToolName]: (typeof contentToolContracts)[Name]['input'] };

export const contentToolOutputSchemas = Object.fromEntries(
  CONTENT_TOOL_NAMES.map((name) => [name, contentToolContracts[name].output]),
) as { [Name in ContentToolName]: (typeof contentToolContracts)[Name]['output'] };

const PRIMARY_SCOPE_TOOLS = new Set<ContentToolName>([
  'folder.list',
  'document.parse',
  'document.scan',
  'document.create',
  'document.list',
  'document.search',
  'content.search',
  'content.search-history.list',
  'content.search-history.delete',
]);

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
    return canonical.extend({ folders: z.array(folder).min(1).max(100) });
  }
  if (name === 'document.search-all') return contentToolContracts[name].input.omit({ organizationKey: true });
  if (hasPrimaryModelScope(name)) {
    const canonical: z.ZodTypeAny = contentToolContracts[name].input;
    const object = canonical instanceof z.ZodEffects ? canonical.innerType() : canonical;
    return (object as z.AnyZodObject).omit({ scopeKey: true });
  }
  return contentToolContracts[name].input;
}

/** Strict model-visible inputs. Canonical HTTP contracts retain untrusted selectors. */
export const contentToolModelInputSchemas = Object.fromEntries(
  CONTENT_TOOL_NAMES.map((name) => [name, modelInputSchema(name)]),
) as Record<ContentToolName, z.ZodTypeAny>;

function providerInputSchema(name: ContentToolName) {
  const schema = contentZodToJsonSchema(contentToolModelInputSchemas[name]);
  if (name === 'document.parse' || name === 'document.scan') {
    const properties = schema.properties as Record<string, unknown>;
    const fileHandle = {
      type: 'object',
      description: 'Server-side file handle with name, type, size, and arrayBuffer(). Provider clients cannot send raw file bytes through JSON.',
    };
    if (name === 'document.parse') properties.file = fileHandle;
    else properties.pages = { type: 'array', minItems: 1, maxItems: 12, items: fileHandle };
  }
  if (name === 'document.unshare') {
    schema.oneOf = [
      { required: ['shareKeys'], not: { required: ['documentKeys'] } },
      { required: ['documentKeys'], not: { required: ['shareKeys'] } },
    ];
  }
  if (name === 'document.update') {
    const properties = schema.properties as Record<string, any>;
    properties.updates.items.oneOf = [
      { required: ['content'] },
      { required: ['isFavorite'], not: { required: ['content'] } },
    ];
  }
  if (name === 'document.read') {
    schema.description = 'When both offsets are supplied, endOffset must be greater than startOffset.';
  }
  return schema;
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
