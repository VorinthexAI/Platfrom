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
import type { AppSpeechService } from '@/lib/app-speech/service';
import { PUBLIC_TOOL_DEFINITIONS, TRUSTED_TOOL_DEFINITIONS, UNIFIED_TOOL_DEFINITIONS } from './tool-definitions';
import type { PublicToolDependencies } from './tool-definition';
import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolDependencies } from './workspace-tool-definitions';
import type { TrustedEmailToolDependencies, TrustedEmailToolName } from './email-ingestion-tool-definitions';
import type { TrustedAccountToolDependencies, TrustedAccountToolName } from './account-tool-definitions';
import type { TrustedCommunicationToolDependencies, TrustedCommunicationToolName } from './communication-tool-definitions';
import { CONVERSATION_TOOL_DEFINITIONS } from './conversation-tool-definitions';
import type { AgentRuntimeDependencies } from '@/lib/ai/agents';
import { AGENT_TOOL_DEFINITIONS } from './agent-tool-definitions';
import type { AgentToolDependencies } from './agent-tool-definitions';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { APP_KEYS } from '@/lib/apps/registry';
import type { ToolEventRecorder } from '@/lib/ai/events/service';
import type { TeamService } from '@/lib/teams';
import type { CostService } from '@/lib/costs/service';
import { appGenerateImageModelInputSchema, imageGenerationReferenceKeysSchema, type ImageDestination } from '@/lib/image-generation/service';

/** A tool name has exactly one registry entry. */
export const TOOL_NAMES = UNIFIED_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
export const toolNameSchema = z.enum(TOOL_NAMES);
export const MODEL_TOOL_NAMES = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name) as [string, ...string[]];
const modelToolNameSchema = z.enum(MODEL_TOOL_NAMES);
const publicToolDefinitionsByName = new Map(PUBLIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const workspaceToolDefinitionsByName = new Map(WORKSPACE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const trustedToolDefinitionsByName = new Map(TRUSTED_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const conversationToolDefinitionsByName = new Map(CONVERSATION_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
const agentToolDefinitionsByName = new Map(AGENT_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
export type TrustedToolName = TrustedEmailToolName | TrustedAccountToolName | TrustedCommunicationToolName;
export type TrustedToolDependencies = TrustedEmailToolDependencies & TrustedAccountToolDependencies & TrustedCommunicationToolDependencies;

/** Input validation for the one canonical definition of each public tool. */
export const toolInputSchemas: Record<string, z.ZodTypeAny> = Object.fromEntries(
  UNIFIED_TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema]),
);

export const TOOL_DEFINITIONS = PUBLIC_TOOL_DEFINITIONS.map(({ providerDefinition }) => providerDefinition);

/** Authoritative input-aware execution-effect classification for model-visible tools. */
export function isToolReadOnly(name: string, rawInput: unknown) {
  const toolName = modelToolNameSchema.parse(name);
  const definition = publicToolDefinitionsByName.get(toolName)!;
  return definition.isReadOnly(rawInput);
}
export interface ToolDependencies extends RouterDependencies, DocumentParseDependencies, Pick<ImageCaptionToolDependencies, 'executeImageCaption'>, Pick<ImageCreateVisualIdentityToolDependencies, 'executeDescription'> {
  signal?: AbortSignal;
  teamKey?: string;
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
  imageDestination?: ImageDestination;
  appSearchService?: AppSearchService;
  appTransformationService?: AppTransformationService;
  appSpeechService?: AppSpeechService;
  accountProfileService?: WorkspaceToolDependencies['accountProfile'];
  profileBadgeService?: WorkspaceToolDependencies['profileBadges'];
  ticketService?: WorkspaceToolDependencies['tickets'];
  scopeTagService?: WorkspaceToolDependencies['scopeTags'];
  commerceService?: WorkspaceToolDependencies['commerce'];
  costService?: CostService;
  appNotificationService?: WorkspaceToolDependencies['appNotifications'];
  userInboxService?: WorkspaceToolDependencies['userInbox'];
  scopeService?: WorkspaceToolDependencies['scopes'];
  referralService?: WorkspaceToolDependencies['referrals'];
  teamService?: TeamService;
  conversationService?: AgentToolDependencies['conversations'];
  currentConversationKey?: string;
  currentUserMessageContent?: string;
  currentReferenceImageKeys?: string[];
  currentStagedImageArtifactKeys?: string[];
  agentDependencies?: AgentRuntimeDependencies;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
}

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'image.caption', skill: string, rawInput: ImageCaptionInput, dependencies: ToolDependencies & { contentContext: ToolContext }): Promise<ImageCaptionOutput>;
export function runTool(name: 'image.search', skill: string, rawInput: ImageSearchInput, dependencies: ToolDependencies & { contentContext: ToolContext }): ReturnType<typeof galleryOperations.search>;
export function runTool<Name extends ContentToolName>(name: Name, skill: string, rawInput: ContentToolInput<Name>, dependencies: ToolDependencies & { contentContext: ToolContext }): Promise<ContentToolOutput<Name>>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies & { contentContext: ToolContext }): Promise<unknown>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies & { contentContext: ToolContext }): Promise<unknown> {
  const toolName = modelToolNameSchema.parse(name);
  toolInputSchemas[toolName]!.parse(rawInput);
  return observeToolExecution(toolName, dependencies.contentContext, async () => {
    if (toolName === imageCaptionTool.name) return imageCaptionTool.execute(rawInput, dependencies);
    if (toolName === imageCreateVisualIdentityTool.name) return imageCreateVisualIdentityTool.execute(rawInput, dependencies);
    if (toolName === 'app.generate-image') {
      if (!dependencies.requestKey) throw new Error('app.generate-image requires a trusted request key.');
      const input = appGenerateImageModelInputSchema.parse(rawInput);
      const references = imageGenerationReferenceKeysSchema.parse(dependencies.currentReferenceImageKeys ?? []);
      const destination = dependencies.currentConversationKey
        ? { kind: 'conversation' as const, conversationKey: dependencies.currentConversationKey }
        : dependencies.imageDestination ?? { kind: 'managed-gallery' as const };
      if (destination.kind === 'conversation') {
        if (!dependencies.conversationService) throw new Error('app.generate-image requires the trusted conversation service for a conversation destination.');
        if (input.count !== 1) throw new Error('Conversation image generation requires exactly one image.');
        const { count: _count, ...creative } = input;
        return dependencies.conversationService.enqueueImageTurn({ ...creative, referenceImageKeys: references, conversationKey: destination.conversationKey, requestKey: dependencies.requestKey, ...(dependencies.currentUserMessageContent ? { userMessage: dependencies.currentUserMessageContent } : {}) }, dependencies.contentContext, dependencies.currentStagedImageArtifactKeys ?? []);
      }
      const images = dependencies.images ?? (await import('@/lib/image-generation/service')).imageGenerationService;
      return images.generate(input, destination, dependencies.contentContext, dependencies.requestKey, references);
    }
    const agentDefinition = agentToolDefinitionsByName.get(toolName);
    if (agentDefinition) return agentDefinition.execute(rawInput, { context: dependencies.contentContext, conversations: dependencies.conversationService, requestKey: dependencies.requestKey, agentDependencies: dependencies.agentDependencies });
    const conversationDefinition = conversationToolDefinitionsByName.get(toolName);
    if (conversationDefinition) return conversationDefinition.execute(rawInput, { context: dependencies.contentContext, conversations: dependencies.conversationService, requestKey: dependencies.requestKey, currentConversationKey: dependencies.currentConversationKey, currentReferenceImageKeys: dependencies.currentReferenceImageKeys });
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
      appSpeech: dependencies.appSpeechService,
      accountProfile: dependencies.accountProfileService,
      profileBadges: dependencies.profileBadgeService,
      tickets: dependencies.ticketService,
      scopeTags: dependencies.scopeTagService,
      commerce: dependencies.commerceService,
      costs: dependencies.costService,
      appNotifications: dependencies.appNotificationService,
      userInbox: dependencies.userInboxService,
      scopes: dependencies.scopeService,
      referrals: dependencies.referralService,
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
      requestKey: dependencies.requestKey,
      teamService: dependencies.teamService,
      signal: dependencies.signal,
      timeoutMs: dependencies.timeoutMs,
      executeContent: dependencies.executeWorkspaceContent,
      content: {
        adapters: dependencies.adapters,
        env: dependencies.env,
        ...dependencies.contentDependencies,
        ingestion: { ...dependencies, ...dependencies.contentDependencies?.ingestion },
      },
    });
  }, { recorder: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, idempotencyKey: dependencies.requestKey, input: rawInput, ...dependencies.billing });
}

/** Executes a system-only tool without exposing it to Core or model providers. */
export async function runTrustedTool(name: TrustedToolName, rawInput: unknown, dependencies: TrustedToolDependencies): Promise<unknown> {
  const definition = trustedToolDefinitionsByName.get(name);
  if (!definition) throw new Error(`Unknown trusted tool ${name}`);
  definition.inputSchema.parse(rawInput);
  if (name === 'account.delete' || name === 'communication.staff.reply') {
    return (definition.execute as (input: unknown, dependencies: TrustedToolDependencies) => Promise<unknown>)(rawInput, dependencies);
  }
  return observeToolExecution(name, dependencies.context, () => (definition.execute as (input: unknown, dependencies: TrustedToolDependencies) => Promise<unknown>)(rawInput, dependencies), { appKey: APP_KEYS.SIGNAL, appScopeKey: 'appScopeKey' in dependencies ? dependencies.appScopeKey as string | undefined : undefined, recorder: dependencies.recordEvent, input: rawInput });
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
