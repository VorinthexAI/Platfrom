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
let storageOperation = Promise.resolve<unknown>(undefined);

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = storageOperation.then(work, work);
  storageOperation = next.catch(() => undefined);
  return next;
}

function selectionKey(context: ConversationContext) {
  return `${SELECTION_KEY_PREFIX}.${context.userKey}.${context.organizationKey}.${context.scopeKey}`;
}

export function readConversationSelection(context: ConversationContext): Promise<Conversation | undefined> {
  return serialize(async () => {
    const key = selectionKey(context);
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return undefined;
    try { return storedConversationSchema.parse(JSON.parse(raw)); }
    catch { await SecureStore.deleteItemAsync(key); return undefined; }
  });
}

export function writeConversationSelection(context: ConversationContext, conversation?: Conversation) {
  return serialize(() => conversation
    ? SecureStore.setItemAsync(selectionKey(context), JSON.stringify(storedConversationSchema.parse(conversation)), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
    : SecureStore.deleteItemAsync(selectionKey(context)));
}
