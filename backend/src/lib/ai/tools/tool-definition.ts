import { z } from 'zod';
import { ARCHIVE_TOOL_DEFINITIONS, archiveToolInputSchemas, isArchiveToolName } from './archive-registry';
import { runArchiveTool, type ArchiveToolDependencies } from './archive-runtime';
import { domainToolInputSchemas, isDomainActionSlug } from './domain-schemas';
import { domainToolJsonSchemas } from './domain-interpret';
import { executeDomainTool, type DomainToolContext, type DomainToolExecutionOptions } from './domain-execute';

export interface PublicToolDependencies {
  context: DomainToolContext;
  archive?: ArchiveToolDependencies;
  domain?: DomainToolExecutionOptions;
}

const archiveDefinitions = new Map(ARCHIVE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** Builds one direct public tool definition over the private domain/archive runtimes. */
export function createPublicToolDefinition(name: string) {
  const archiveDefinition = isArchiveToolName(name) ? archiveDefinitions.get(name) : undefined;
  const domainSchema = isDomainActionSlug(name) ? domainToolInputSchemas[name] : undefined;
  const archiveSchema = isArchiveToolName(name) ? archiveToolInputSchemas[name] : undefined;
  if (!domainSchema && !archiveSchema) throw new Error(`Unknown public tool ${name}`);
  const inputSchema = domainSchema && archiveSchema ? z.union([domainSchema, archiveSchema]) : domainSchema ?? archiveSchema!;
  const providerDefinition = {
    name,
    description: archiveDefinition?.description ?? name,
    inputSchema: archiveDefinition && domainSchema ? { oneOf: [domainToolJsonSchemas[name]!, archiveDefinition.inputSchema] } : domainSchema ? domainToolJsonSchemas[name]! : archiveDefinition!.inputSchema,
    ...(archiveDefinition?.outputSchema ? { outputSchema: archiveDefinition.outputSchema } : {}),
  };
  return {
    name,
    inputSchema,
    providerDefinition,
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      const lifecycleInput = Boolean(rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) && 'items' in rawInput);
      if (isDomainActionSlug(name) && (!isArchiveToolName(name) || lifecycleInput)) return executeDomainTool(name, rawInput, dependencies.context, dependencies.domain);
      return runArchiveTool(name as Parameters<typeof runArchiveTool>[0], rawInput, dependencies.context, dependencies.archive);
    },
  };
}
