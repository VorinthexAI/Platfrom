import * as SecureStore from "expo-secure-store";
import { z } from "zod";

import type { Conversation, ConversationContext } from "./conversation-client";

const SELECTION_KEY_PREFIX = "vorinthex.conversation.selection.v1";
const storedConversationSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1).max(200),
  isFavorite: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const selections = new Map<string, Conversation>();

function selectionKey(context: ConversationContext) {
  return `${SELECTION_KEY_PREFIX}.${context.userKey}.${context.teamKey}.${context.scopeKey}`;
}

function forgetPersistedSelection(key: string) {
  void SecureStore.deleteItemAsync(key).catch(() => undefined);
}

export async function readConversationSelection(context: ConversationContext): Promise<Conversation | undefined> {
  const key = selectionKey(context);
  forgetPersistedSelection(key);
  return selections.get(key);
}

export async function writeConversationSelection(context: ConversationContext, conversation?: Conversation) {
  const key = selectionKey(context);
  forgetPersistedSelection(key);
  if (!conversation) {
    selections.delete(key);
    return;
  }
  selections.set(key, storedConversationSchema.parse(conversation));
}
