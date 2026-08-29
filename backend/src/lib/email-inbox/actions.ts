import { z } from 'zod';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers/types';
import { currentEmbeddingSchema, prepareEmbeddingText, type EmbedTextInput } from '@/lib/embeddings';

export async function executeEmailAsk<TOutput = ChatOutput>(organizationKey: string, rawInput: CoreChatInput, options: ExecuteActionOptions = {}) {
  const { mode, ...input } = coreChatInputSchema.parse(rawInput);
  return executeAction<typeof input, TOutput>({
    mode: 'model', organizationKey, actionSlug: 'ask',
    modelSlug: mode === 'deep' ? 'openai.gpt-5.6-luna' : 'google.gemini-2.5-flash-lite',
  }, input, options);
}

const emailEmbeddingInputSchema = z.object({ text: z.string().trim().min(1), purpose: z.enum(['document', 'query']).default('document') }).strict();
export async function executeEmailEmbedding(organizationKey: string, rawInput: EmbedTextInput, options: ExecuteActionOptions = {}) {
  const input = emailEmbeddingInputSchema.parse({ text: rawInput.text, purpose: rawInput.purpose });
  const response = await executeAction<{ text: string }, { embedding: number[] }>({ mode: 'auto', organizationKey, actionSlug: 'embed' }, { text: prepareEmbeddingText(input.text, input.purpose) }, { ...options, signal: rawInput.signal ?? options.signal, timeoutMs: rawInput.timeoutMs ?? options.timeoutMs });
  return currentEmbeddingSchema.parse(response.output.embedding);
}
