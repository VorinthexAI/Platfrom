import { z } from "zod";
import { apiClient } from "./api-client";
import { conversationContextSchema, type ConversationContext } from "./conversation-client";
import type { AgentGreetingOccasion } from "@/state/ui";

const responseSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({ message: z.string().trim().min(1).max(500), showReferralCodeAction: z.boolean() }),
});

export async function requestAgentGreeting(context: ConversationContext, occasion: AgentGreetingOccasion, signal?: AbortSignal) {
  const { teamKey, scopeKey } = conversationContextSchema.parse(context);
  const body = z.strictObject({
    teamKey: z.string().min(1),
    scopeKey: z.string().min(1),
    occasion: z.enum(["onboarding", "returning"]),
  }).parse({ teamKey, scopeKey, occasion });
  return responseSchema.parse((await apiClient.post("/agent/greeting", body, { signal, timeout: 45_000 })).data).data;
}
