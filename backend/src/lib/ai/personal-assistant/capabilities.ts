import { z } from 'zod';
import type { CoreChatToolDefinition } from '@/lib/ai/actions/core-chat';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { runContentTool, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import type { TravelService } from '@/lib/travel/service';
import type { CountrySearchService } from '@/lib/travel/country-search';
import type { EmailService } from '@/lib/email-inbox/service';
import type { BookService } from '@/lib/books/service';
import type { UserHiddenService } from '@/lib/user-hiddens/service';
import type { GalleryOperationContext, GalleryOperationName } from '@/lib/gallery/operations';
import type { ImageGenerationService } from '@/lib/image-generation/service';
import type { AppSearchService } from '@/lib/app-search/service';
import type { AppTransformationService } from '@/lib/app-transformation/service';
import type { AppAudioService } from '@/lib/app-audio/service';
import { appAudioCapability, appEnhanceCapability, appSearchCapability, appTranslateCapability, archiveCapabilities, ascendCapabilities, compassCapabilities, hiddenListCapability, signalCapabilities } from './service-capabilities';
import { galleryAssistantCapabilities, galleryAssistantCapabilityNames } from './gallery-capabilities';

export const assistantSurfaceSchema = z.enum(['knowledge-workspace', 'media-workspace', 'book-workspace', 'travel-workspace', 'signal-workspace']);
export type AssistantSurface = z.infer<typeof assistantSurfaceSchema>;

export const assistantSourceSchema = z.object({
  documentKey: z.string().cuid(),
  name: z.string().trim().min(1),
}).strict();
export type AssistantSource = z.infer<typeof assistantSourceSchema>;

export type AssistantCapabilityResult =
  | { kind: 'continue'; result: unknown; sources?: AssistantSource[] }
  | { kind: 'note'; content: string; message: string };

export interface AssistantCapabilityContext {
  signal?: AbortSignal;
  timeoutMs?: number;
  currentDocumentKey?: string;
  currentNote?: { content: string; selection?: { start: number; end: number } };
  domain: ToolContext;
  folderKey?: string;
  requestKey?: string;
  clientRequestKey?: string | null;
  contentDependencies?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  travel?: TravelService;
  countries?: CountrySearchService;
  email?: EmailService;
  books?: BookService;
  userHiddens?: UserHiddenService;
  gallery?: Partial<Record<GalleryOperationName, (input: unknown, context: GalleryOperationContext) => Promise<unknown>>>;
  images?: ImageGenerationService;
  appSearch?: AppSearchService;
  appTransformation?: AppTransformationService;
  appAudio?: AppAudioService;
}

export type MutationWorkspace = 'archive' | 'gallery' | 'signal' | 'compass' | 'ascend';

export interface AssistantCapability<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  inputSchema: Schema;
  definition: CoreChatToolDefinition;
  mutationWorkspace?: MutationWorkspace | ((input: unknown) => MutationWorkspace | undefined);
  execute(input: unknown, context: AssistantCapabilityContext): Promise<AssistantCapabilityResult>;
}

export class AssistantCapabilityRegistry {
  readonly #capabilities = new Map<string, AssistantCapability>();
  readonly #surfaces = new Map<AssistantSurface, string[]>();

  register(capability: AssistantCapability) {
    if (this.#capabilities.has(capability.definition.name)) throw new Error(`Assistant capability already registered: ${capability.definition.name}`);
    this.#capabilities.set(capability.definition.name, capability);
    return this;
  }

  registerSurface(surface: AssistantSurface, capabilityNames: string[]) {
    for (const name of capabilityNames) if (!this.#capabilities.has(name)) throw new Error(`Unknown assistant capability: ${name}`);
    this.#surfaces.set(surface, [...capabilityNames]);
    return this;
  }

  resolve(surface: AssistantSurface) {
    return (this.#surfaces.get(surface) ?? []).map((name) => this.#capabilities.get(name)!);
  }
}

const writeNoteInputSchema = z.object({
  content: z.string().max(40_000),
  message: z.string().trim().min(1).max(500),
}).strict();
const writeNoteCapability: AssistantCapability = {
  inputSchema: writeNoteInputSchema,
  definition: {
    name: 'note.write',
    description: 'Replace the open note with complete new content. Use for both writing a blank note and editing an existing note. The content argument must contain the entire resulting note, not a patch.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', maxLength: 40_000 },
        message: { type: 'string', minLength: 1, maxLength: 500, description: 'Briefly explain what was written or changed.' },
      },
      required: ['content', 'message'],
      additionalProperties: false,
    },
  },
  async execute(rawInput) {
    const input = writeNoteInputSchema.parse(rawInput);
    return { kind: 'note', ...input };
  },
};

export const defaultAssistantCapabilityRegistry = new AssistantCapabilityRegistry();

for (const item of [appSearchCapability, appEnhanceCapability, appTranslateCapability, appAudioCapability, hiddenListCapability, ...archiveCapabilities, ...galleryAssistantCapabilities, ...compassCapabilities, ...signalCapabilities, ...ascendCapabilities]) defaultAssistantCapabilityRegistry.register(item);

defaultAssistantCapabilityRegistry
  .register(writeNoteCapability)
  .registerSurface('knowledge-workspace', ['app.search', 'app.enhance', 'app.translate', 'app.audio', 'content.hidden.list', ...archiveCapabilities.map(({ definition }) => definition.name), 'note.write'])
  .registerSurface('media-workspace', ['app.search', 'content.hidden.list', ...galleryAssistantCapabilityNames])
  .registerSurface('book-workspace', ['app.search', ...ascendCapabilities.map(({ definition }) => definition.name)])
  .registerSurface('travel-workspace', ['app.search', ...compassCapabilities.filter(({ definition }) => !['country.search', 'place.search', 'trip.search'].includes(definition.name)).map(({ definition }) => definition.name)])
  .registerSurface('signal-workspace', ['app.search', 'app.enhance', 'app.translate', ...signalCapabilities.filter(({ definition }) => !['inbox.search', 'email.tone.search'].includes(definition.name)).map(({ definition }) => definition.name)]);
