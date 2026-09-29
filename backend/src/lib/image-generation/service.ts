import { z } from 'zod';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

export const appGenerateImageModelInputSchema = z.object({ prompt: z.string().trim().min(1).max(4_000), count: z.number().int().min(1).max(4).default(1) }).strict();
export const imageGenerationReferenceKeysSchema = z.array(z.string().cuid()).max(4).default([]);
export const managedImageGenerateInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  referenceImageKeys: z.array(z.string().cuid()).max(8).default([]),
}).strict();
export type ImageDestination = { kind: 'conversation'; conversationKey: string } | { kind: 'folder'; folderKey?: string };
export type ResolvedImageGenerationReference = { identity: string; inputReference: string };
export type ImageGenerationService = {
  generateManaged: (...args: unknown[]) => Promise<{ images: Array<{ key: string; caption: string }> }>;
};

export const imageGenerationService = {
  async generate(..._args: unknown[]) { throw new Error('Image generation into gallery is retired.'); },
  async generateManaged(..._args: unknown[]): Promise<{ images: Array<{ key: string; caption: string }> }> { throw new Error('Image generation into gallery is retired.'); },
};

export function createImageGenerationService(): ImageGenerationService {
  return imageGenerationService;
}

export async function generateImageForConversation(_input: unknown, _context: ToolContext) {
  throw new Error('Use conversation image turns.');
}
