import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import {
  imageCaptionInputSchema,
  imageCaptionOutputSchema,
  type ImageCaptionInput,
  type ImageCaptionOutput,
  type ProviderExecuteResponse,
} from '@/lib/ai/providers';
import { IMAGE_CAPTION_MODEL, MAX_IMAGE_CAPTION_URLS } from '@/lib/image-caption-constants';

export interface ImageCaptionToolDependencies extends ExecuteActionOptions {
  organizationKey?: string;
  executeImageCaption?: (
    organizationKey: string,
    input: ImageCaptionInput,
  ) => Promise<ProviderExecuteResponse<ImageCaptionOutput>>;
}

export const imageCaptionTool = {
  name: 'image.caption',
  inputSchema: imageCaptionInputSchema,
  providerDefinition: {
    name: 'image.caption',
    description: 'Generate one rich, detailed caption for each supplied image URL.',
    inputSchema: {
      type: 'object',
      required: ['imageUrls'],
      additionalProperties: false,
      properties: {
        imageUrls: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_IMAGE_CAPTION_URLS,
          items: { type: 'string', format: 'uri', pattern: '^https?://' },
        },
        purpose: { type: 'string', enum: ['caption', 'document-transcription', 'document-reconciliation'], default: 'caption' },
        referenceTexts: { type: 'array', minItems: 1, maxItems: MAX_IMAGE_CAPTION_URLS, items: { type: 'object', additionalProperties: false, required: ['primary', 'secondary'], properties: { primary: { type: 'string' }, secondary: { type: 'string' } } } },
      },
    },
  },
  async execute(
    rawInput: unknown,
    dependencies: ImageCaptionToolDependencies = {},
  ): Promise<ImageCaptionOutput> {
    const input = imageCaptionInputSchema.parse(rawInput);
    const organizationKey = dependencies.organizationKey ?? 'nexus';
    const response = dependencies.executeImageCaption
      ? await dependencies.executeImageCaption(organizationKey, input)
      : await executeAction<ImageCaptionInput, ImageCaptionOutput>({
          mode: 'fixed',
          organizationKey,
          actionSlug: 'caption-image',
          modelSlug: IMAGE_CAPTION_MODEL,
          providerSlug: 'openrouter',
        }, input, dependencies);
    const output = imageCaptionOutputSchema.parse(response.output);
    if (output.captions.length !== input.imageUrls.length) {
      throw new Error('Image caption count must match the supplied image count.');
    }
    return output;
  },
} as const;
