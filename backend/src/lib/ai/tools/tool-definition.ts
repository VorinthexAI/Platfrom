import { CONTENT_TOOL_DEFINITIONS, contentToolModelInputSchemas, hasContentIdempotencyKey, hasPrimaryModelScope } from './content-registry';
import { runContentTool, type ContentToolDependencies } from './content-runtime';
import type { ContentToolName } from './content-schemas';
import type { ToolContext } from './tool-context';

export interface PublicToolDependencies {
  context: ToolContext;
  content?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  requestKey?: string;
}

const contentDefinitions = new Map(CONTENT_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** Builds one public tool definition over the canonical Content runtime. */
export function createPublicToolDefinition<Name extends ContentToolName>(name: Name) {
  const providerDefinition = contentDefinitions.get(name);
  if (!providerDefinition) throw new Error(`Unknown Content tool ${name}`);
  const inputSchema = contentToolModelInputSchemas[name];
  return {
    name,
    inputSchema,
    providerDefinition,
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      const input = inputSchema.parse(rawInput) as Record<string, unknown>;
      const canonicalInput = name === 'folder.create'
        ? { ...input, folders: (input.folders as Record<string, unknown>[]).map((folder) => ({ scopeKey: dependencies.context.runtimeScopeKey, ...folder })) }
        : name === 'document.search-all'
          ? { organizationKey: dependencies.context.organizationKey, ...input }
          : hasPrimaryModelScope(name)
            ? { scopeKey: dependencies.context.runtimeScopeKey, ...input }
            : input;
      const trustedInput = dependencies.requestKey && hasContentIdempotencyKey(name) ? { ...canonicalInput, idempotencyKey: dependencies.requestKey } : canonicalInput;
      return (dependencies.executeContent ?? runContentTool)(name, trustedInput as never, dependencies.context, dependencies.content);
    },
  };
}
