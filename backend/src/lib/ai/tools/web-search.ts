import { z } from 'zod';
import { webOutputSchema, type WebOutput } from '@/lib/ai/actions/web';
import { executeWebSearch, type ExecuteActionOptions } from '@/lib/ai/router';
import type { ProviderExecuteResponse } from '@/lib/ai/providers';

export const webSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(20_000),
}).strict();
export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export interface WebSearchToolDependencies extends ExecuteActionOptions {
  organizationKey?: string;
  executeSearch?: (organizationKey: string, input: { prompt: string }, options: ExecuteActionOptions) => Promise<ProviderExecuteResponse<WebOutput>>;
}

export const webSearchTool = {
  name: 'web.search',
  inputSchema: webSearchInputSchema,
  isReadOnly: () => true,
  providerDefinition: {
    name: 'web.search',
    description: 'Search the public web for current or externally verifiable information and return a grounded answer with source citations. Use for recent events, changing facts, live information, or claims that require lookup outside the workspace.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: { query: { type: 'string', minLength: 1, maxLength: 20_000 } },
    },
  },
  async execute(rawInput: unknown, dependencies: WebSearchToolDependencies = {}): Promise<WebOutput> {
    const input = webSearchInputSchema.parse(rawInput);
    if (!dependencies.organizationKey) throw new Error('web.search requires an authorized organization.');
    const options: ExecuteActionOptions = {
      adapters: dependencies.adapters,
      env: dependencies.env,
      signal: dependencies.signal,
      timeoutMs: dependencies.timeoutMs,
      providers: ['web.primary'],
    };
    const response = dependencies.executeSearch
      ? await dependencies.executeSearch(dependencies.organizationKey, { prompt: input.query }, options)
      : await executeWebSearch<WebOutput>(dependencies.organizationKey, { prompt: input.query }, options);
    return webOutputSchema.parse(response.output);
  },
} as const;
