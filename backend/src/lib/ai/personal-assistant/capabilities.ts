import { z } from 'zod';
import type { CoreChatToolDefinition } from '@/lib/ai/actions/core-chat';
import type { DomainToolContext } from '@/lib/ai/tools/domain-execute';
import { runContentTool, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import { imageSearchTool } from '@/lib/ai/tools/image-search';

export const assistantSurfaceSchema = z.enum(['knowledge-workspace', 'media-workspace', 'book-workspace', 'travel-workspace']);
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
  domain: DomainToolContext;
  folderKey?: string;
  requestKey?: string;
  contentDependencies?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  executeImageSearch?: typeof imageSearchTool.execute;
}

export interface AssistantCapability {
  definition: CoreChatToolDefinition;
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
const bookBriefJsonSchema = {
  topic: { type: 'string', minLength: 3, maxLength: 500 },
  goal: { type: 'string', minLength: 3, maxLength: 1_000 },
  audience: { type: 'string', minLength: 2, maxLength: 500 },
  tone: { type: 'string', minLength: 2, maxLength: 200 },
  length: { type: 'string', enum: ['short', 'standard', 'deep'] },
  language: { type: 'string', minLength: 2, maxLength: 100 },
  sourceNotes: { type: 'string', minLength: 1, maxLength: 12_000 },
} as const;

const searchKnowledgeCapability: AssistantCapability = {
  definition: {
    name: 'search_knowledge',
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
  definition: {
    name: 'write_note',
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
  definition: {
    name: 'search_images',
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
  definition: {
    name: 'book_create_context',
    description: 'Create the planning context for a new personalized book after the user explicitly asks to create one. Call this before book_write.',
    inputSchema: { type: 'object', properties: bookBriefJsonSchema, required: ['topic', 'goal', 'audience', 'tone', 'length', 'language'], additionalProperties: false },
  },
  async execute(rawInput, context) {
    const input = bookBriefSchema.parse(rawInput);
    return { kind: 'continue', result: await (context.executeContent ?? runContentTool)('book.create-context', { scopeKey: context.domain.runtimeScopeKey, ...input, ...(context.requestKey ? { idempotencyKey: `${context.requestKey}:context` } : {}) }, context.domain, context.contentDependencies) };
  },
};

const writeBookCapability: AssistantCapability = {
  definition: {
    name: 'book_write',
    description: 'Write, narrate, and finish a book created by book_create_context. Use the returned bookKey and the exact same brief.',
    inputSchema: { type: 'object', properties: { bookKey: { type: 'string', minLength: 20, maxLength: 30 }, ...bookBriefJsonSchema }, required: ['bookKey', 'topic', 'goal', 'audience', 'tone', 'length', 'language'], additionalProperties: false },
  },
  async execute(rawInput, context) {
    const input = bookWriteInputSchema.parse(rawInput);
    return { kind: 'continue', result: await (context.executeContent ?? runContentTool)('book.write', { scopeKey: context.domain.runtimeScopeKey, ...input, ...(context.requestKey ? { idempotencyKey: `${context.requestKey}:write` } : {}) }, context.domain, context.contentDependencies) };
  },
};

export const defaultAssistantCapabilityRegistry = new AssistantCapabilityRegistry()
  .register(searchKnowledgeCapability)
  .register(writeNoteCapability)
  .register(searchImagesCapability)
  .register(createBookContextCapability)
  .register(writeBookCapability)
  .registerSurface('knowledge-workspace', ['search_knowledge', 'write_note'])
  .registerSurface('media-workspace', ['search_images'])
  .registerSurface('book-workspace', ['book_create_context', 'book_write'])
  .registerSurface('travel-workspace', ['search_knowledge']);
