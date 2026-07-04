import { z } from 'zod';

export const getPostSchemaInputSchema = z.object({
  platform: z.string(),
});

export async function get_post_schema(input: z.infer<typeof getPostSchemaInputSchema>) {
  const { platform } = getPostSchemaInputSchema.parse(input);
  if (platform.toLowerCase() === 'reddit') {
    return z.object({ title: z.string(), body: z.string() });
  }
  if (['tiktok', 'instagram'].includes(platform.toLowerCase())) {
    return z.object({ caption: z.string() });
  }
  return z.object({ text: z.string() });
}

