import { z } from 'zod';
import { documentToolContracts, type DocumentToolName } from './document-tool-contracts';
import { documentZodToJsonSchema } from './document-tool-json-schema';

export const DOCUMENT_TOOL_NAMES = Object.freeze(Object.keys(documentToolContracts) as DocumentToolName[]);
export const documentToolNameSchema = z.enum(DOCUMENT_TOOL_NAMES as [DocumentToolName, ...DocumentToolName[]]);

export const documentToolInputSchemas = Object.fromEntries(
  DOCUMENT_TOOL_NAMES.map((name) => [name, documentToolContracts[name].input]),
) as { [Name in DocumentToolName]: (typeof documentToolContracts)[Name]['input'] };

export const documentToolOutputSchemas = Object.fromEntries(
  DOCUMENT_TOOL_NAMES.map((name) => [name, documentToolContracts[name].output]),
) as { [Name in DocumentToolName]: (typeof documentToolContracts)[Name]['output'] };

function providerInputSchema(name: DocumentToolName) {
  const schema = documentZodToJsonSchema(documentToolContracts[name].input);
  if (name === 'document.processing') {
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
      { required: ['html'], not: { anyOf: [{ required: ['json'] }, { required: ['content'] }] } },
      { required: ['json'], not: { anyOf: [{ required: ['html'] }, { required: ['content'] }] } },
      { required: ['content'], not: { anyOf: [{ required: ['html'] }, { required: ['json'] }] } },
    ];
  }
  if (name === 'document.read') {
    schema.description = 'When both offsets are supplied, endOffset must be greater than startOffset.';
  }
  return schema;
}

export const DOCUMENT_TOOL_DEFINITIONS = Object.freeze(DOCUMENT_TOOL_NAMES.map((name) => Object.freeze({
  name,
  description: documentToolContracts[name].description,
  inputSchema: providerInputSchema(name),
  outputSchema: documentZodToJsonSchema(documentToolContracts[name].output),
})));

export function isDocumentToolName(value: string): value is DocumentToolName {
  return Object.prototype.hasOwnProperty.call(documentToolContracts, value);
}
