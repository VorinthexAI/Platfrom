import { z } from 'zod';
import type { CoreChatToolDefinition } from '@/lib/ai/actions/core-chat';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import type { DomainToolContext } from '@/lib/ai/tools/domain-execute';
import { runContentTool, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import { imageSearchTool } from '@/lib/ai/tools/image-search';
import type { TravelService } from '@/lib/travel/service';
import type { EmailService } from '@/lib/email-inbox/service';
import type { BookService } from '@/lib/books/service';
import type { UserSettingsService } from '@/lib/user-settings/service';
import type { GalleryOperationContext, GalleryOperationName } from '@/lib/gallery/operations';
import { archiveCapabilities, ascendCapabilities, compassCapabilities, signalCapabilities } from './service-capabilities';
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
  currentDocumentKey?: string;
  currentNote?: { content: string; selection?: { start: number; end: number } };
  domain: DomainToolContext;
  folderKey?: string;
  requestKey?: string;
  contentDependencies?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  executeImageSearch?: typeof imageSearchTool.execute;
  travel?: TravelService;
  email?: EmailService;
  books?: BookService;
  userSettings?: UserSettingsService;
  gallery?: Partial<Record<GalleryOperationName, (input: unknown, context: GalleryOperationContext) => Promise<unknown>>>;
}

export interface AssistantCapability<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  inputSchema: Schema;
  definition: CoreChatToolDefinition;
  mutationWorkspace?: 'archive' | 'gallery' | 'signal' | 'compass' | 'ascend';
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

const searchInputSchema = z.object({ query: z.string().trim().min(1).max(8_000) }).strict();
const writeNoteInputSchema = z.object({
  content: z.string().max(40_000),
  message: z.string().trim().min(1).max(500),
}).strict();
const bookBriefSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  goal: z.string().trim().min(3).max(1_000),
  audience: z.string().trim().min(2).max(500),
  tone: z.string().trim().min(2).max(200),
  length: z.enum(['short', 'standard', 'deep']),
  language: z.string().trim().min(2).max(100),
  sourceNotes: z.string().trim().min(1).max(12_000).optional(),
}).strict();
const bookWriteInputSchema = bookBriefSchema.extend({ bookKey: z.string().cuid() }).strict();
const searchKnowledgeCapability: AssistantCapability = {
  inputSchema: searchInputSchema,
  definition: {
    name: 'knowledge.search',
    description: 'Search knowledge the user is authorized to access. Use this before answering requests that depend on stored notes or documents.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 8_000 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async execute(rawInput, context) {
    const input = searchInputSchema.parse(rawInput);
    const output = await (context.executeContent ?? runContentTool)('scope.document.search', {
      scopeKey: context.domain.runtimeScopeKey,
      query: input.query,
      ...(context.folderKey ? { sources: [{ type: 'folder' as const, folderKeys: [context.folderKey], includeDescendants: true }] } : {}),
      topK: 8,
      include: ['snippet'],
    }, context.domain, context.contentDependencies);
    return {
      kind: 'continue',
      result: output,
      sources: output.results.map(({ documentKey, name }) => ({ documentKey, name })),
    };
  },
};

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

const searchImagesCapability: AssistantCapability = {
  inputSchema: searchInputSchema,
  definition: {
    name: 'image.search',
    description: 'Search the user\'s Gallery images by visible subjects, objects, actions, setting, style, colors, lighting, or readable text.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 8_000 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async execute(rawInput, context) {
    const input = searchInputSchema.parse(rawInput);
    return { kind: 'continue', result: await (context.executeImageSearch ?? imageSearchTool.execute)({ query: input.query, limit: 50 }, { context: context.domain }) };
  },
};

const createBookContextCapability: AssistantCapability = {
  inputSchema: bookBriefSchema,
  definition: {
    name: 'book.create-context',
    description: 'Create the planning context for a new personalized book after the user explicitly asks to create one. Call this before book.write.',
    inputSchema: contentZodToJsonSchema(bookBriefSchema),
  },
  async execute(rawInput, context) {
    const input = bookBriefSchema.parse(rawInput);
    return { kind: 'continue', result: await (context.executeContent ?? runContentTool)('book.create-context', { scopeKey: context.domain.runtimeScopeKey, ...input, ...(context.requestKey ? { idempotencyKey: `${context.requestKey}:context` } : {}) }, context.domain, context.contentDependencies) };
  },
};

const writeBookCapability: AssistantCapability = {
  inputSchema: bookWriteInputSchema,
  mutationWorkspace: 'ascend',
  definition: {
    name: 'book.write',
    description: 'Write, narrate, and finish a book created by book.create-context. Use the returned bookKey and the exact same brief.',
    inputSchema: contentZodToJsonSchema(bookWriteInputSchema),
  },
  async execute(rawInput, context) {
    const input = bookWriteInputSchema.parse(rawInput);
    return { kind: 'continue', result: await (context.executeContent ?? runContentTool)('book.write', { scopeKey: context.domain.runtimeScopeKey, ...input, ...(context.requestKey ? { idempotencyKey: `${context.requestKey}:write` } : {}) }, context.domain, context.contentDependencies) };
  },
};

export const defaultAssistantCapabilityRegistry = new AssistantCapabilityRegistry();

for (const item of [...archiveCapabilities, ...galleryAssistantCapabilities, ...compassCapabilities, ...signalCapabilities, ...ascendCapabilities]) defaultAssistantCapabilityRegistry.register(item);

defaultAssistantCapabilityRegistry
  .register(searchKnowledgeCapability)
  .register(writeNoteCapability)
  .register(createBookContextCapability)
  .register(writeBookCapability)
  .registerSurface('knowledge-workspace', [...archiveCapabilities.map(({ definition }) => definition.name), 'knowledge.search', 'note.write'])
  .registerSurface('media-workspace', galleryAssistantCapabilityNames)
  .registerSurface('book-workspace', [...ascendCapabilities.map(({ definition }) => definition.name), 'book.create-context', 'book.write'])
  .registerSurface('travel-workspace', compassCapabilities.map(({ definition }) => definition.name))
  .registerSurface('signal-workspace', signalCapabilities.map(({ definition }) => definition.name));
