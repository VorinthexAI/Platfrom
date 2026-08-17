import { z } from 'zod';
import type { CoreChatInput } from '@/lib/ai/actions';
import type { RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ImageCaptionInput, ImageCaptionOutput, ProviderExecuteResponse, ProviderStreamChunk, TranscribeInput, TranscriptionOutput } from '@/lib/ai/providers';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import type { DocumentParseDependencies } from '@/lib/ai/document-processing';
import type { ContentToolDependencies } from './content-runtime';
import type { ContentToolInput, ContentToolName, ContentToolOutput } from './content-schemas';
import type { DomainActionSlug } from './domain-schemas';
import type { DomainToolContext, DomainToolExecutionOptions } from './domain-execute';
import { orchestratorChatTool, orchestratorChatToolInputSchema } from './orchestrator-chat';
import { transcribeTool, type TranscribeToolDependencies } from './transcribe';
import { audioGenerateTool, type AudioGenerateDependencies, type AudioGenerateInput, type AudioGenerateOutput } from './audio-generate';
import { imageCaptionTool, type ImageCaptionToolDependencies } from './image-caption';
import { imageCreateVisualIdentityTool, type ImageCreateVisualIdentityToolDependencies } from './image-create-visual-identity';
import { imageSearchTool, type ImageSearchInput, type ImageSearchToolDependencies } from './image-search';
import type { ImageSimilarityOutput } from './image-similarity';
import { PUBLIC_TOOL_DEFINITIONS } from './tool-definitions';
import type { PublicToolDependencies } from './tool-definition';
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolDependencies } from './workspace-tool-definitions';
import type { RetrievalContext, RetrievalDependencies } from './retrieval';

/**
 * A tool name has exactly one registry entry. Content lifecycle calls retain
 * their legacy `{ items, atomic }` form while Content clients use key arrays.
 */
export const TOOL_NAMES = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
export const toolNameSchema = z.enum(TOOL_NAMES);
const publicToolDefinitionsByName = new Map(PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const workspaceToolDefinitionsByName = new Map(WORKSPACE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** Input validation for the one canonical definition of each public tool. */
export const toolInputSchemas: Record<string, z.ZodTypeAny> = Object.fromEntries(
  PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema]),
);

export const TOOL_DEFINITIONS = PUBLIC_TOOL_DEFINITIONS.map(({ providerDefinition }) => providerDefinition);
export { orchestratorChatToolInputSchema };

export interface ToolDependencies extends RouterDependencies, DocumentParseDependencies, RetrievalDependencies, Pick<TranscribeToolDependencies, 'executeTranscription'>, Pick<AudioGenerateDependencies, 'synthesize'>, Pick<ImageCaptionToolDependencies, 'executeImageCaption'>, Pick<ImageCreateVisualIdentityToolDependencies, 'executeDescription'>, Pick<ImageSearchToolDependencies, 'executeEmbedding' | 'searchImages'> {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
  organizationKey?: string;
  retrievalContext?: RetrievalContext;
  embedRetrievalQuery?: (text: string, signal?: AbortSignal) => Promise<number[]>;
  retrievalTimeoutMs?: number;
  contentContext?: DomainToolContext;
  contentDependencies?: ContentToolDependencies;
  domainDependencies?: DomainToolExecutionOptions;
  timeoutMs?: number;
  requestKey?: string;
  travelService?: WorkspaceToolDependencies['travel'];
  emailService?: WorkspaceToolDependencies['email'];
  bookService?: WorkspaceToolDependencies['books'];
  userSettingsService?: WorkspaceToolDependencies['userSettings'];
  executeWorkspaceContent?: WorkspaceToolDependencies['executeContent'];
}

const chatOutputSchema = z.object({
  text: z.string().trim().min(1),
  toolCalls: z.array(z.unknown()),
  stopReason: z.string().nullable(),
}).strict();

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'chat', skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<string>;
export function runTool(name: 'transcribe', skill: string, rawInput: TranscribeInput, dependencies?: ToolDependencies): Promise<TranscriptionOutput>;
export function runTool(name: 'audio.generate', skill: string, rawInput: AudioGenerateInput, dependencies?: ToolDependencies): Promise<AudioGenerateOutput>;
export function runTool(name: 'image.caption', skill: string, rawInput: ImageCaptionInput, dependencies?: ToolDependencies): Promise<ImageCaptionOutput>;
export function runTool(name: 'image.search', skill: string, rawInput: ImageSearchInput, dependencies: ToolDependencies & { contentContext: DomainToolContext }): Promise<ImageSimilarityOutput>;
export function runTool<Name extends ContentToolName>(name: Name, skill: string, rawInput: ContentToolInput<Name>, dependencies: ToolDependencies & { contentContext: DomainToolContext }): Promise<ContentToolOutput<Name>>;
export function runTool<Name extends DomainActionSlug>(name: Name, skill: string, rawInput: unknown, dependencies: ToolDependencies & { contentContext: DomainToolContext }): Promise<unknown>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<unknown>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): Promise<unknown> {
  const toolName = toolNameSchema.parse(name);
  if (toolName === orchestratorChatTool.name) return orchestratorChatTool.execute(skill, rawInput, dependencies);
  if (toolName === transcribeTool.name) return transcribeTool.execute(rawInput, dependencies);
  if (toolName === audioGenerateTool.name) return audioGenerateTool.execute(rawInput, { ...dependencies, organizationKey: dependencies.organizationKey ?? dependencies.contentContext?.organizationKey });
  if (toolName === imageCaptionTool.name) return imageCaptionTool.execute(rawInput, dependencies);
  if (toolName === imageCreateVisualIdentityTool.name) return imageCreateVisualIdentityTool.execute(rawInput, dependencies);
  if (toolName === imageSearchTool.name) {
    if (!dependencies.contentContext) throw new Error(`Tool ${toolName} requires contentContext.`);
    return imageSearchTool.execute(rawInput, { ...dependencies, context: dependencies.contentContext });
  }
  if (!dependencies.contentContext) throw new Error(`Tool ${toolName} requires contentContext.`);
  const workspaceDefinition = workspaceToolDefinitionsByName.get(toolName);
  if (workspaceDefinition) return workspaceDefinition.execute(rawInput, {
    context: dependencies.contentContext,
    requestKey: dependencies.requestKey,
    executeContent: dependencies.executeWorkspaceContent,
    travel: dependencies.travelService,
    email: dependencies.emailService,
    books: dependencies.bookService,
    userSettings: dependencies.userSettingsService,
    content: {
      adapters: dependencies.adapters,
      credentials: dependencies.credentials,
      ...dependencies.contentDependencies,
      ingestion: { ...dependencies, ...dependencies.contentDependencies?.ingestion },
    },
  });
  const definition = publicToolDefinitionsByName.get(toolName) as Exclude<(typeof PUBLIC_TOOL_DEFINITIONS)[number], typeof orchestratorChatTool | typeof transcribeTool>;
  return (definition.execute as (input: unknown, dependencies: PublicToolDependencies) => Promise<unknown>)(rawInput, {
    context: dependencies.contentContext,
    domain: dependencies.domainDependencies,
    content: {
      adapters: dependencies.adapters,
      credentials: dependencies.credentials,
      ...dependencies.contentDependencies,
      ingestion: { ...dependencies, ...dependencies.contentDependencies?.ingestion },
    },
  });
}

export async function* streamTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): AsyncIterable<ProviderStreamChunk> {
  const toolName = toolNameSchema.parse(name);
  if (toolName !== orchestratorChatTool.name) throw new Error(`Tool ${toolName} does not support streaming.`);
  yield* orchestratorChatTool.stream(skill, rawInput, dependencies);
}

export { sanitizeAgentInput, sanitizedAgentMessageSchema } from './input-sanitizer';
export { retrievalTool, retrievalInputSchema, retrievalFiltersSchema, retrieveNodeDocuments } from './retrieval';
export { audioGenerateTool, imageCaptionTool, imageCreateVisualIdentityTool, imageSearchTool, transcribeTool };
export * from './audio-generate';
export { imageSearchInputSchema } from './image-search';
export { imageSimilarityOutputSchema } from './image-similarity';
export type { RetrievalContext, RetrievalDependencies, RetrievalDocument, RetrievalFilters, RetrievalNodeResult } from './retrieval';
export * from './content-errors';
export * from './content-schemas';
export * from './content-json-schema';
export * from './content-registry';
export * from './content-runtime';
export * from './content-run';
export * from './domain-schemas';
export * from './domain-execute';
export * from './domain-run';
export * from './domain-interpret';
export * from './domain-access-engine';
