import { z } from 'zod';
import type { CoreChatInput } from '@/lib/ai/actions';
import type { RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ProviderExecuteResponse, ProviderStreamChunk } from '@/lib/ai/providers';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import type { DocumentProcessingDependencies } from '@/lib/ai/document-processing';
import type { ArchiveToolDependencies } from './archive-runtime';
import type { ArchiveToolInput, ArchiveToolName, ArchiveToolOutput } from './archive-schemas';
import type { DomainActionSlug } from './domain-schemas';
import type { DomainToolContext, DomainToolExecutionOptions } from './domain-execute';
import { orchestratorChatTool, orchestratorChatToolInputSchema } from './orchestrator-chat';
import { PUBLIC_TOOL_DEFINITIONS } from './tool-definitions';
import type { PublicToolDependencies } from './tool-definition';

/**
 * A tool name has exactly one registry entry. Archive lifecycle calls retain
 * their legacy `{ items, atomic }` form while Archive clients use key arrays.
 */
export const TOOL_NAMES = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
export const toolNameSchema = z.enum(TOOL_NAMES);
const publicToolDefinitionsByName = new Map(PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** Input validation for the one canonical definition of each public tool. */
export const toolInputSchemas: Record<string, z.ZodTypeAny> = Object.fromEntries(
  PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema]),
);

export const TOOL_DEFINITIONS = PUBLIC_TOOL_DEFINITIONS.map(({ providerDefinition }) => providerDefinition);
export { orchestratorChatToolInputSchema };

export interface ToolDependencies extends RouterDependencies, DocumentProcessingDependencies {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
  archiveContext?: DomainToolContext;
  archiveDependencies?: ArchiveToolDependencies;
  domainDependencies?: DomainToolExecutionOptions;
}

const chatOutputSchema = z.object({
  text: z.string().trim().min(1),
  toolCalls: z.array(z.unknown()),
  stopReason: z.string().nullable(),
}).strict();

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'orchestrator.chat', skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<string>;
export function runTool<Name extends ArchiveToolName>(name: Name, skill: string, rawInput: ArchiveToolInput<Name>, dependencies: ToolDependencies & { archiveContext: DomainToolContext }): Promise<ArchiveToolOutput<Name>>;
export function runTool<Name extends DomainActionSlug>(name: Name, skill: string, rawInput: unknown, dependencies: ToolDependencies & { archiveContext: DomainToolContext }): Promise<unknown>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<unknown>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): Promise<unknown> {
  const toolName = toolNameSchema.parse(name);
  if (toolName === orchestratorChatTool.name) return orchestratorChatTool.execute(skill, rawInput, dependencies);
  if (!dependencies.archiveContext) throw new Error(`Tool ${toolName} requires archiveContext.`);
  const definition = publicToolDefinitionsByName.get(toolName) as Exclude<(typeof PUBLIC_TOOL_DEFINITIONS)[number], typeof orchestratorChatTool>;
  return definition.execute(rawInput, {
    context: dependencies.archiveContext,
    domain: dependencies.domainDependencies,
    archive: {
      adapters: dependencies.adapters,
      credentials: dependencies.credentials,
      ...dependencies.archiveDependencies,
      ingestion: { ...dependencies, ...dependencies.archiveDependencies?.ingestion },
    },
  } satisfies PublicToolDependencies);
}

export async function* streamTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): AsyncIterable<ProviderStreamChunk> {
  const toolName = toolNameSchema.parse(name);
  if (toolName !== orchestratorChatTool.name) throw new Error(`Tool ${toolName} does not support streaming.`);
  yield* orchestratorChatTool.stream(skill, rawInput, dependencies);
}

export { sanitizeAgentInput, sanitizedAgentMessageSchema } from './input-sanitizer';
export * from './archive-errors';
export * from './archive-schemas';
export * from './archive-json-schema';
export * from './archive-registry';
export * from './archive-runtime';
export * from './archive-run';
export * from './domain-schemas';
export * from './domain-execute';
export * from './domain-run';
export * from './domain-interpret';
export * from './domain-access-engine';
