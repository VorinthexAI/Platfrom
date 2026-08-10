import { z } from 'zod';
import type { CoreChatToolDefinition } from '@/lib/ai/actions/core-chat';
import type { DomainToolContext } from '@/lib/ai/tools/domain-execute';
import { runContentTool, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';

export const assistantSurfaceSchema = z.enum(['knowledge-workspace']);
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
  contentDependencies?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
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

export const defaultAssistantCapabilityRegistry = new AssistantCapabilityRegistry()
  .register(searchKnowledgeCapability)
  .register(writeNoteCapability)
  .registerSurface('knowledge-workspace', ['search_knowledge', 'write_note']);
