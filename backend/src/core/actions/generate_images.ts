import { z } from 'zod';
import { get_model } from './get_model';

export const generateImagesInputSchema = z.object({
  concepts: z.array(z.object({
    prompt: z.string(),
    style: z.string().optional(),
    mood: z.string().optional(),
    subject: z.string().optional(),
  })),
});

export async function generate_images(input: z.infer<typeof generateImagesInputSchema>) {
  const parsed = generateImagesInputSchema.parse(input);
  const model = await get_model({ category: 'image' });
  return parsed.concepts.map((concept, index) => ({
    index,
    model,
    prompt: concept.prompt,
    storage_path: null,
    status: 'not_generated_without_provider_credentials',
  }));
}

