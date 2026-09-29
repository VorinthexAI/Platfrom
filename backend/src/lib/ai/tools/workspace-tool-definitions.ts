import { z } from 'zod';
import type { ToolContext } from './tool-context';
import { runContentTool, type ContentToolDependencies } from './content-runtime';
import { scopeService } from '@/lib/ai/scopes/service';
import { searchFiles } from '@/lib/app-search/service';

export interface WorkspaceToolDependencies {
  context: ToolContext;
  requestKey?: string;
  content?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const emptySchema = z.object({}).strict();
const scopeCreateSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(10_000).optional() }).strict();
const scopeKeySchema = z.object({ targetScopeKey: z.string().cuid() }).strict();
const appSearchSchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  operation: z.enum(['search', 'list', 'count']).default('search'),
  collectionSlugs: z.array(z.enum(['folders', 'files'])).min(1).max(2).optional(),
  folderKey: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

function definition<Input extends z.ZodTypeAny>(name: string, description: string, inputSchema: Input, isReadOnly: boolean, execute: (input: z.output<Input>, dependencies: WorkspaceToolDependencies) => Promise<unknown>) {
  return {
    name,
    inputSchema,
    providerDefinition: { name, description, inputSchema: { type: 'object' } },
    isReadOnly() { return isReadOnly; },
    async execute(rawInput: unknown, dependencies: WorkspaceToolDependencies) {
      return execute(inputSchema.parse(rawInput) as z.output<Input>, dependencies);
    },
  };
}

export const WORKSPACE_MUTATION_TOOL_NAMES = Object.freeze(['scope.create', 'scope.select', 'scope.update', 'scope.delete']);

export const WORKSPACE_TOOL_DEFINITIONS = Object.freeze([
  definition('scope.list', 'List scopes owned by the current user.', emptySchema, true, async (_input, dependencies) => scopeService.list(dependencies.context)),
  definition('scope.create', 'Create a scope.', scopeCreateSchema, false, async (input, dependencies) => scopeService.create(input, dependencies.context)),
  definition('scope.select', 'Select the current scope.', scopeKeySchema, false, async (input, dependencies) => scopeService.select(input, dependencies.context)),
  definition('scope.update', 'Update a scope.', scopeKeySchema.extend({ name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().min(1).max(10_000).nullable().optional() }).strict(), false, async (input, dependencies) => scopeService.update(input, dependencies.context)),
  definition('scope.delete', 'Delete a scope.', scopeKeySchema, false, async (input, dependencies) => scopeService.delete(input, dependencies.context)),
  definition('app.search', 'Search folders and files in the current scope.', appSearchSchema, true, async (input, dependencies) => searchFiles(dependencies.context, input)),
]);
