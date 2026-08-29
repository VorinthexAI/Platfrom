import { z } from 'zod';
import type { RouterDependencies } from '@/lib/ai/router';
import type { ImageCaptionInput, ImageCaptionOutput } from '@/lib/ai/providers';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import type { DocumentParseDependencies } from '@/lib/ai/document-processing';
import type { ContentToolDependencies } from './content-runtime';
import type { ContentToolInput, ContentToolName, ContentToolOutput } from './content-schemas';
import type { ToolContext } from './tool-context';
import { imageCaptionTool, type ImageCaptionToolDependencies } from './image-caption';
import { imageCreateVisualIdentityTool, type ImageCreateVisualIdentityToolDependencies } from './image-create-visual-identity';
import type { ImageSearchInput } from './image-search';
import type { galleryOperations } from '@/lib/gallery/operations';
import type { AppSearchService } from '@/lib/app-search/service';
import type { AppTransformationService } from '@/lib/app-transformation/service';
import type { AppAudioService } from '@/lib/app-audio/service';
import { PUBLIC_TOOL_DEFINITIONS, TRUSTED_TOOL_DEFINITIONS, UNIFIED_TOOL_DEFINITIONS } from './tool-definitions';
import type { PublicToolDependencies } from './tool-definition';
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolDependencies } from './workspace-tool-definitions';
import type { TrustedEmailToolDependencies, TrustedEmailToolName } from './email-ingestion-tool-definitions';

/** A tool name has exactly one registry entry. */
export const TOOL_NAMES = UNIFIED_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
export const toolNameSchema = z.enum(TOOL_NAMES);
export const MODEL_TOOL_NAMES = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
const modelToolNameSchema = z.enum(MODEL_TOOL_NAMES);
const publicToolDefinitionsByName = new Map(PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const workspaceToolDefinitionsByName = new Map(WORKSPACE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const trustedToolDefinitionsByName = new Map(TRUSTED_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** Input validation for the one canonical definition of each public tool. */
export const toolInputSchemas: Record<string, z.ZodTypeAny> = Object.fromEntries(
  UNIFIED_TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema]),
);

export const TOOL_DEFINITIONS = PUBLIC_TOOL_DEFINITIONS.map(({ providerDefinition }) => providerDefinition);
export interface ToolDependencies extends RouterDependencies, DocumentParseDependencies, Pick<ImageCaptionToolDependencies, 'executeImageCaption'>, Pick<ImageCreateVisualIdentityToolDependencies, 'executeDescription'> {
  signal?: AbortSignal;
  organizationKey?: string;
  contentContext?: ToolContext;
  contentDependencies?: ContentToolDependencies;
  timeoutMs?: number;
  requestKey?: string;
  travelService?: WorkspaceToolDependencies['travel'];
  countrySearchService?: WorkspaceToolDependencies['countries'];
  emailService?: WorkspaceToolDependencies['email'];
  bookService?: WorkspaceToolDependencies['books'];
  userHiddenService?: WorkspaceToolDependencies['userHiddens'];
  executeWorkspaceContent?: WorkspaceToolDependencies['executeContent'];
  gallery?: WorkspaceToolDependencies['gallery'];
  images?: WorkspaceToolDependencies['images'];
  appSearchService?: AppSearchService;
  appTransformationService?: AppTransformationService;
  appAudioService?: AppAudioService;
}

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'image.caption', skill: string, rawInput: ImageCaptionInput, dependencies?: ToolDependencies): Promise<ImageCaptionOutput>;
export function runTool(name: 'image.search', skill: string, rawInput: ImageSearchInput, dependencies: ToolDependencies & { contentContext: ToolContext }): ReturnType<typeof galleryOperations.search>;
export function runTool<Name extends ContentToolName>(name: Name, skill: string, rawInput: ContentToolInput<Name>, dependencies: ToolDependencies & { contentContext: ToolContext }): Promise<ContentToolOutput<Name>>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<unknown>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): Promise<unknown> {
  const toolName = modelToolNameSchema.parse(name);
  if (toolName === imageCaptionTool.name) return imageCaptionTool.execute(rawInput, dependencies);
  if (toolName === imageCreateVisualIdentityTool.name) return imageCreateVisualIdentityTool.execute(rawInput, dependencies);
  if (!dependencies.contentContext) throw new Error(`Tool ${toolName} requires contentContext.`);
  const workspaceDefinition = workspaceToolDefinitionsByName.get(toolName);
  if (workspaceDefinition) return workspaceDefinition.execute(rawInput, {
    context: dependencies.contentContext,
    requestKey: dependencies.requestKey,
    executeContent: dependencies.executeWorkspaceContent,
    travel: dependencies.travelService,
    countries: dependencies.countrySearchService,
    email: dependencies.emailService,
    books: dependencies.bookService,
    userHiddens: dependencies.userHiddenService,
    gallery: dependencies.gallery,
    images: dependencies.images,
    appSearch: dependencies.appSearchService,
    appTransformation: dependencies.appTransformationService,
    appAudio: dependencies.appAudioService,
    signal: dependencies.signal,
    timeoutMs: dependencies.timeoutMs,
    content: {
      adapters: dependencies.adapters,
      env: dependencies.env,
      ...dependencies.contentDependencies,
      ingestion: { ...dependencies, ...dependencies.contentDependencies?.ingestion },
    },
  });
  const definition = publicToolDefinitionsByName.get(toolName)!;
  return (definition.execute as (input: unknown, dependencies: PublicToolDependencies) => Promise<unknown>)(rawInput, {
    context: dependencies.contentContext,
    executeContent: dependencies.executeWorkspaceContent,
    content: {
      adapters: dependencies.adapters,
      env: dependencies.env,
      ...dependencies.contentDependencies,
      ingestion: { ...dependencies, ...dependencies.contentDependencies?.ingestion },
    },
  });
}

/** Executes a system-only tool without exposing it to Core or model providers. */
export async function runTrustedTool(name: TrustedEmailToolName, rawInput: unknown, dependencies: TrustedEmailToolDependencies): Promise<unknown> {
  const definition = trustedToolDefinitionsByName.get(name);
  if (!definition) throw new Error(`Unknown trusted tool ${name}`);
  return definition.execute(rawInput, dependencies);
}

export { sanitizeAgentInput, sanitizedAgentMessageSchema } from './input-sanitizer';
export { retrievalTool, retrievalInputSchema, retrievalFiltersSchema, retrieveNodeDocuments } from './retrieval';
export { imageCaptionTool, imageCreateVisualIdentityTool };
export { imageSearchTool } from './image-search';
export { imageSearchInputSchema } from './image-search';
export { imageSimilarityOutputSchema } from './image-similarity';
export type { RetrievalContext, RetrievalDependencies, RetrievalDocument, RetrievalFilters, RetrievalNodeResult } from './retrieval';
export * from './content-errors';
export * from './content-schemas';
export * from './content-json-schema';
export * from './content-registry';
export * from './content-runtime';
export * from './content-run';
export * from './tool-context';
export * from './domain-access-engine';
