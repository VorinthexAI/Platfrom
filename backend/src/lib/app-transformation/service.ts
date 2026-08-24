import { z } from 'zod';
import { coreChatInputSchema } from '@/lib/ai/actions';
import { generateDocumentTranslation, generateTextEnhancement, type TextGeneration } from '@/lib/ai/actions/document-text-generation';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers/types';

const text = z.string().trim().min(1).max(50_000);
const instruction = z.string().trim().min(1).max(8_000).optional();

export const appTextEnhanceInputSchema = z.object({ text, instruction }).strict();
export const appTextTranslateInputSchema = z.object({
  text,
  targetLanguage: z.string().trim().min(2).max(100),
  sourceLanguage: z.string().trim().min(2).max(100).optional(),
  instruction,
}).strict();
export const appTextTransformationOutputSchema = z.object({ text: z.string().trim().min(1) }).strict();

export interface AppTransformationService {
  enhance(input: z.input<typeof appTextEnhanceInputSchema>, organizationKey: string, options?: ExecuteActionOptions): Promise<{ text: string }>;
  translate(input: z.input<typeof appTextTranslateInputSchema>, organizationKey: string, options?: ExecuteActionOptions): Promise<{ text: string }>;
}

export function createAppTransformationService(dependencies: { generate?: (organizationKey: string, request: Parameters<TextGeneration>[0], options?: ExecuteActionOptions) => Promise<string> } = {}): AppTransformationService {
  const generate = dependencies.generate ?? (async (organizationKey, request, options) => {
    const { mode: _mode, organizationProviderKey: _organizationProviderKey, ...input } = coreChatInputSchema.parse({
      systemPrompt: request.systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.text }] }],
      options: { temperature: request.temperature, maxTokens: request.maxTokens },
    });
    const response = await executeAction<typeof input, ChatOutput>({ mode: 'model', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite' }, input, options);
    return response.output.text;
  });
  return {
    async enhance(rawInput, organizationKey, options) {
      const input = appTextEnhanceInputSchema.parse(rawInput);
      return appTextTransformationOutputSchema.parse({ text: await generateTextEnhancement({ content: input.text, instruction: input.instruction }, (request) => generate(organizationKey, request, options)) });
    },
    async translate(rawInput, organizationKey, options) {
      const input = appTextTranslateInputSchema.parse(rawInput);
      return appTextTransformationOutputSchema.parse({ text: await generateDocumentTranslation({ content: input.text, targetLanguage: input.targetLanguage, sourceLanguage: input.sourceLanguage, instruction: input.instruction, preserveFormatting: true }, (request) => generate(organizationKey, request, options)) });
    },
  };
}
