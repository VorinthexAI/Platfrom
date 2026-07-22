import { z } from 'zod';
import { archiveToolContracts, type ArchiveToolName } from './schemas';
import { archiveZodToJsonSchema } from './json-schema';

export const ARCHIVE_TOOL_NAMES = Object.freeze(Object.keys(archiveToolContracts) as ArchiveToolName[]);
export const archiveToolNameSchema = z.enum(ARCHIVE_TOOL_NAMES as [ArchiveToolName, ...ArchiveToolName[]]);

export const archiveToolInputSchemas = Object.fromEntries(
  ARCHIVE_TOOL_NAMES.map((name) => [name, archiveToolContracts[name].input]),
) as { [Name in ArchiveToolName]: (typeof archiveToolContracts)[Name]['input'] };

export const archiveToolOutputSchemas = Object.fromEntries(
  ARCHIVE_TOOL_NAMES.map((name) => [name, archiveToolContracts[name].output]),
) as { [Name in ArchiveToolName]: (typeof archiveToolContracts)[Name]['output'] };

function providerInputSchema(name: ArchiveToolName) {
  const schema = archiveZodToJsonSchema(archiveToolContracts[name].input);
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

export const ARCHIVE_TOOL_DEFINITIONS = Object.freeze(ARCHIVE_TOOL_NAMES.map((name) => Object.freeze({
  name,
  description: archiveToolContracts[name].description,
  inputSchema: providerInputSchema(name),
  outputSchema: archiveZodToJsonSchema(archiveToolContracts[name].output),
})));

export function isArchiveToolName(value: string): value is ArchiveToolName {
  return Object.prototype.hasOwnProperty.call(archiveToolContracts, value);
}
