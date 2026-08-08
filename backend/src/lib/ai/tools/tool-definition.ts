import { z } from 'zod';
import { CONTENT_TOOL_DEFINITIONS, contentToolInputSchemas, isContentToolName } from './content-registry';
import { runContentTool, type ContentToolDependencies } from './content-runtime';
import { domainToolInputSchemas, isDomainActionSlug } from './domain-schemas';
import { domainToolJsonSchemas } from './domain-interpret';
import { executeDomainTool, type DomainToolContext, type DomainToolExecutionOptions } from './domain-execute';

export interface PublicToolDependencies {
  context: DomainToolContext;
  content?: ContentToolDependencies;
  domain?: DomainToolExecutionOptions;
}

const contentDefinitions = new Map(CONTENT_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** Builds one direct public tool definition over the private domain/content runtimes. */
export function createPublicToolDefinition(name: string) {
  const contentDefinition = isContentToolName(name) ? contentDefinitions.get(name) : undefined;
  const domainSchema = isDomainActionSlug(name) ? domainToolInputSchemas[name] : undefined;
  const contentSchema = isContentToolName(name) ? contentToolInputSchemas[name] : undefined;
  if (!domainSchema && !contentSchema) throw new Error(`Unknown public tool ${name}`);
  const inputSchema = domainSchema && contentSchema ? z.union([domainSchema, contentSchema]) : domainSchema ?? contentSchema!;
  const providerDefinition = {
    name,
    description: contentDefinition?.description ?? name,
    inputSchema: contentDefinition && domainSchema ? { oneOf: [domainToolJsonSchemas[name]!, contentDefinition.inputSchema] } : domainSchema ? domainToolJsonSchemas[name]! : contentDefinition!.inputSchema,
    ...(contentDefinition?.outputSchema ? { outputSchema: contentDefinition.outputSchema } : {}),
  };
  return {
    name,
    inputSchema,
    providerDefinition,
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      const lifecycleInput = Boolean(rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) && 'items' in rawInput);
      if (isDomainActionSlug(name) && (!isContentToolName(name) || lifecycleInput)) return executeDomainTool(name, rawInput, dependencies.context, dependencies.domain);
      return runContentTool(name as Parameters<typeof runContentTool>[0], rawInput, dependencies.context, dependencies.content);
    },
  };
}
