import { z } from "zod";

import { apiClient } from "@/lib/api-client";

const contextSchema = z.strictObject({ organizationKey: z.string().trim().min(1), scopeKey: z.string().trim().min(1) });
const outputSchema = z.strictObject({ text: z.string().trim().min(1) });
const responseSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: outputSchema }),
  z.strictObject({ success: z.literal(false), error: z.object({ message: z.string().min(1) }) }),
]);

export type AppTransformationContext = z.output<typeof contextSchema>;

async function transform(context: AppTransformationContext, path: "/app/enhance" | "/app/translate", input: Record<string, unknown>) {
  try {
    const response = await apiClient.post(path, { ...contextSchema.parse(context), input }, { timeout: 4 * 60_000 });
    const result = responseSchema.parse(response.data);
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  } catch (error) {
    const failure = (error as { response?: { data?: { success?: boolean; error?: { message?: string } } } }).response?.data;
    throw failure?.success === false && typeof failure.error?.message === "string" ? new Error(failure.error.message) : error;
  }
}

export function enhanceAppTextForContext(context: AppTransformationContext, text: string) {
  return transform(context, "/app/enhance", { text: z.string().trim().min(1).max(50_000).parse(text) });
}

export function translateAppTextForContext(context: AppTransformationContext, text: string, targetLanguage: string) {
  return transform(context, "/app/translate", { text: z.string().trim().min(1).max(50_000).parse(text), targetLanguage: z.string().trim().min(2).max(100).parse(targetLanguage) });
}
