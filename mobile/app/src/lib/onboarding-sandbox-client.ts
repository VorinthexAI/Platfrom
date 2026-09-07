import { z } from "zod";

import { apiClient } from "./api-client";

export const onboardingSandboxPromptSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(300),
});

const sessionSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  prompts: z.array(onboardingSandboxPromptSchema).length(10),
  questionLimit: z.literal(3),
  expiresAt: z.string().datetime(),
});

const answerSchema = z.strictObject({
  promptId: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(5_000),
  answeredCount: z.number().int().min(1).max(3),
  complete: z.boolean(),
});

export type OnboardingSandboxPrompt = z.infer<typeof onboardingSandboxPromptSchema>;
export type OnboardingSandboxSession = z.infer<typeof sessionSchema>;
export type OnboardingSandboxAnswer = z.infer<typeof answerSchema>;

export function selectOnboardingSandboxPrompts(prompts: readonly OnboardingSandboxPrompt[], random = Math.random) {
  const selected = [...prompts];
  for (let index = selected.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [selected[index], selected[swapIndex]] = [selected[swapIndex]!, selected[index]!];
  }
  return selected.slice(0, 3);
}

export async function createOnboardingSandboxSession(signal?: AbortSignal) {
  const response = await apiClient.post("/onboarding/sandbox/sessions", {}, { signal });
  return sessionSchema.parse(response.data);
}

export async function askOnboardingSandboxQuestion(token: string, promptId: string, signal?: AbortSignal) {
  const response = await apiClient.post("/onboarding/sandbox/answers", { token, promptId }, { signal, timeout: 60_000 });
  return answerSchema.parse(response.data);
}
