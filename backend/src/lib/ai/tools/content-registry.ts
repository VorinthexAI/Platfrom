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

function providerInputSchema(name: ContentToolName) {
  const schema = contentZodToJsonSchema(contentToolContracts[name].input);
  if (name === 'document.parse') {
    const properties = schema.properties as Record<string, unknown>;
    properties.file = {
      type: 'object',
      description: 'Server-side file handle with name, type, size, and arrayBuffer(). Provider clients cannot send raw file bytes through JSON.',
    };
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
      { required: ['html'], not: { required: ['content'] } },
      { required: ['content'], not: { required: ['html'] } },
      { required: ['isFavorite'], not: { anyOf: [{ required: ['html'] }, { required: ['content'] }] } },
    ];
  }
  if (name === 'document.create') {
    const properties = schema.properties as Record<string, any>;
    properties.representation.oneOf = [
      { required: ['html'], not: { required: ['content'] } },
      { required: ['content'], not: { required: ['html'] } },
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
