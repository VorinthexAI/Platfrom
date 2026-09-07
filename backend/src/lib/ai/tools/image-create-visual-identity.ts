import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { visualIdentityDescriptionInputSchema, visualIdentityDescriptionOutputSchema, type ProviderExecuteResponse, type VisualIdentityDescriptionInput, type VisualIdentityDescriptionOutput } from '@/lib/ai/providers';

export interface ImageCreateVisualIdentityToolDependencies extends ExecuteActionOptions {
  teamKey?: string;
  executeDescription?: (teamKey: string, input: VisualIdentityDescriptionInput) => Promise<ProviderExecuteResponse<VisualIdentityDescriptionOutput>>;
}

export const imageCreateVisualIdentityTool = {
  name: 'image.create-visual-identity',
  inputSchema: visualIdentityDescriptionInputSchema,
  isReadOnly: () => true,
  providerDefinition: {
    name: 'image.create-visual-identity',
    description: 'Create a detailed recognition profile for one specific visual subject from one or more reference image URLs.',
    inputSchema: { type: 'object', required: ['imageUrls'], additionalProperties: false, properties: {
      imageUrls: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', format: 'uri', pattern: '^https?://' } },
    } },
  },
  async execute(rawInput: unknown, dependencies: ImageCreateVisualIdentityToolDependencies = {}): Promise<VisualIdentityDescriptionOutput> {
    const input = visualIdentityDescriptionInputSchema.parse(rawInput);
    const teamKey = dependencies.teamKey;
    if (!teamKey) throw new Error('image.create-visual-identity requires an authorized team.');
    const response = dependencies.executeDescription
      ? await dependencies.executeDescription(teamKey, input)
      : await executeAction<VisualIdentityDescriptionInput & { operation: 'describe-visual-identity' }, VisualIdentityDescriptionOutput>({ mode: 'auto', teamKey, actionSlug: 'image' }, { operation: 'describe-visual-identity', ...input }, { providers: ['image.primary'], ...dependencies });
    return visualIdentityDescriptionOutputSchema.parse(response.output);
  },
} as const;
