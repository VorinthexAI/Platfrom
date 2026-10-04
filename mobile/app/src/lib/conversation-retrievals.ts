import type { ConversationRetrieval } from "./conversation-client";
import { z } from "zod";
import { FILE_EXTENSIONS } from "./content-client";

export const conversationFileViewSchema = z.strictObject({
  keys: z.array(z.string().cuid()).max(100),
  inventory: z.strictObject({ folderKey: z.string().cuid().optional(), extensions: z.array(z.enum(FILE_EXTENSIONS)).min(1).optional() }).optional(),
});
export type ConversationFileView = z.infer<typeof conversationFileViewSchema>;

export function conversationFileView(retrievals: readonly ConversationRetrieval[]): ConversationFileView | undefined {
  const keys = [...new Set(retrievals.flatMap((retrieval) => retrieval.groups.filter((group) => group.collectionSlug === "files").flatMap((group) => group.results.map((result) => result.key))))];
  if (!keys.length) return undefined;
  const inventory = retrievals.find((item) => item.inventory)?.inventory;
  return conversationFileViewSchema.parse({ keys: keys.slice(0, 100), ...(inventory ? { inventory } : {}) });
}
