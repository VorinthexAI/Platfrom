import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

import type { Conversation, ConversationContext, ConversationMessage, ConversationMessagePage, ConversationPage } from "./conversation-client";

export type ConversationListFilter = { query: string; favoriteOnly: boolean };
const identity = (context: ConversationContext) => [context.userKey, context.teamKey, context.scopeKey] as const;
const normalizedFilter = (filter: ConversationListFilter) => ({ query: filter.query.trim().toLocaleLowerCase(), favoriteOnly: filter.favoriteOnly });

export const conversationQueryKeys = {
  all: (context: ConversationContext) => ["conversations", ...identity(context)] as const,
  lists: (context: ConversationContext) => [...conversationQueryKeys.all(context), "lists"] as const,
  list: (context: ConversationContext, filter: ConversationListFilter) => [...conversationQueryKeys.lists(context), "list", normalizedFilter(filter)] as const,
  messages: (context: ConversationContext, conversationKey: string) => [...conversationQueryKeys.all(context), "messages", conversationKey] as const,
};

export function conversationListFilterFromKey(queryKey: QueryKey): ConversationListFilter | undefined {
  const value = queryKey.at(-1);
  if (!value || typeof value !== "object" || !("query" in value) || !("favoriteOnly" in value) || typeof value.query !== "string" || typeof value.favoriteOnly !== "boolean") return undefined;
  return { query: value.query, favoriteOnly: value.favoriteOnly };
}

export function conversationMatchesFilter(conversation: Conversation, filter: ConversationListFilter) {
  const normalized = normalizedFilter(filter);
  return (!normalized.favoriteOnly || conversation.isFavorite) && (!normalized.query || conversation.name.toLocaleLowerCase().includes(normalized.query));
}

export function compareConversations(left: Conversation, right: Conversation) {
  if (left.isFavorite !== right.isFavorite) return left.isFavorite ? -1 : 1;
  return right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key);
}

export function conversationMessages(data?: InfiniteData<ConversationMessagePage>) {
  return data ? [...data.pages].reverse().flatMap(({ messages }) => messages) : [];
}

function repartition(data: InfiniteData<ConversationPage>, conversations: Conversation[]) {
  let offset = 0;
  const pages = data.pages.map((page) => {
    const size = page.conversations.length;
    const next = { ...page, conversations: conversations.slice(offset, offset + size) };
    offset += size;
    return next;
  });
  if (offset < conversations.length && pages.length) pages[pages.length - 1] = { ...pages[pages.length - 1]!, conversations: [...pages[pages.length - 1]!.conversations, ...conversations.slice(offset)] };
  return { ...data, pages };
}

function updateLists(queryClient: QueryClient, context: ConversationContext, update: (conversations: Conversation[], filter: ConversationListFilter) => Conversation[]) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: conversationQueryKeys.lists(context) })) {
    const filter = conversationListFilterFromKey(query.queryKey);
    if (!filter) continue;
    queryClient.setQueryData<InfiniteData<ConversationPage>>(query.queryKey, (data) => {
      if (!data) return data;
      const flattened = data.pages.flatMap(({ conversations }) => conversations);
      const deduplicated = [...new Map(update(flattened, filter).map((conversation) => [conversation.key, conversation])).values()].sort(compareConversations);
      return repartition(data, deduplicated);
    });
  }
}

export function addConversationToUnfilteredLists(queryClient: QueryClient, context: ConversationContext, conversation: Conversation) {
  updateLists(queryClient, context, (current, filter) => {
    if (filter.query || !conversationMatchesFilter(conversation, filter)) return current;
    return [conversation, ...current.filter(({ key }) => key !== conversation.key)];
  });
}

export function replaceConversationInMatchingLists(queryClient: QueryClient, context: ConversationContext, conversation: Conversation) {
  updateLists(queryClient, context, (current, filter) => {
    if (!current.some(({ key }) => key === conversation.key)) return current;
    return conversationMatchesFilter(conversation, filter)
      ? current.map((item) => item.key === conversation.key ? conversation : item)
      : current.filter(({ key }) => key !== conversation.key);
  });
}

export function conversationListMembershipKeys(queryClient: QueryClient, context: ConversationContext, conversationKey: string): QueryKey[] {
  return queryClient.getQueryCache().findAll({ queryKey: conversationQueryKeys.lists(context) }).filter((query) => {
    const data = query.state.data as InfiniteData<ConversationPage> | undefined;
    return data?.pages.some((page) => page.conversations.some(({ key }) => key === conversationKey));
  }).map(({ queryKey }) => queryKey);
}

export function restoreConversationToLists(queryClient: QueryClient, conversation: Conversation, queryKeys: readonly QueryKey[]) {
  for (const queryKey of queryKeys) queryClient.setQueryData<InfiniteData<ConversationPage>>(queryKey, (data) => {
    if (!data) return data;
    const flattened = data.pages.flatMap(({ conversations }) => conversations);
    if (flattened.some(({ key }) => key === conversation.key)) return data;
    return repartition(data, [...flattened, conversation].sort(compareConversations));
  });
}

export function removeConversationFromLists(queryClient: QueryClient, context: ConversationContext, conversationKey: string) {
  updateLists(queryClient, context, (current) => current.filter(({ key }) => key !== conversationKey));
  queryClient.removeQueries({ queryKey: conversationQueryKeys.messages(context, conversationKey) });
}

export function invalidateConversationSearches(queryClient: QueryClient, context: ConversationContext) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      if (!conversationQueryKeys.lists(context).every((value, index) => queryKey[index] === value)) return false;
      return Boolean(conversationListFilterFromKey(queryKey)?.query);
    },
    refetchType: "active",
  });
}

export type LocalConversationAttachment = {
  local: true;
  clientKey: string;
  kind: "image" | "document";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
};
export type ConversationDisplayAttachment = ConversationMessage["attachments"][number] | LocalConversationAttachment;
export const conversationAttachmentDisplayKey = (attachment: ConversationDisplayAttachment) => "local" in attachment ? attachment.clientKey : attachment.displayKey ?? attachment.key;
export function conversationAttachmentsForRender(previous: readonly ConversationDisplayAttachment[], message: Pick<OptimisticMessage, "attachments" | "attachmentStatus">): ConversationDisplayAttachment[] {
  if (message.attachments.length) return [...message.attachments];
  return message.attachmentStatus === "PENDING" ? [...previous] : [];
}
export type OptimisticMessage = Omit<ConversationMessage, "turnKey" | "completedAt" | "attachments"> & {
  turnKey?: string;
  completedAt?: string;
  attachments: ConversationDisplayAttachment[];
  optimistic?: true;
};

const turnRoleIdentity = ({ turnKey, role }: Pick<OptimisticMessage, "turnKey" | "role">) => turnKey ? `${turnKey}:${role}` : undefined;

export function createLocalConversationAttachments(files: readonly Omit<LocalConversationAttachment, "local">[]): LocalConversationAttachment[] {
  return files.map(({ clientKey, kind, filename, mimeType, sizeBytes, uri }) => ({ local: true, clientKey, kind, filename, mimeType, sizeBytes, uri }));
}

export function mergeConversationMessages(persisted: readonly ConversationMessage[], pending: readonly OptimisticMessage[]) {
  if (!pending.length) return persisted;
  const pendingByIdentity = new Map(pending.map((message) => [turnRoleIdentity(message), message]).filter((entry): entry is [string, OptimisticMessage] => Boolean(entry[0])));
  const pendingByKey = new Map(pending.map((message) => [message.key, message]));
  const consumed = new Set<OptimisticMessage>();
  const merged: OptimisticMessage[] = [];
  for (const message of persisted) {
    const match = pendingByIdentity.get(turnRoleIdentity(message) ?? "") ?? pendingByKey.get(message.key);
    if (!match) merged.push(message);
    else if (!consumed.has(match)) {
      // Keep local attachment previews mounted until the UI has preloaded the
      // durable image and explicitly releases the optimistic overlay.
      merged.push(match);
      consumed.add(match);
    }
  }
  for (const message of pending) if (!consumed.has(message)) merged.push(message);
  return merged;
}

export function settlePendingAttachmentOverlays(persisted: readonly ConversationMessage[], pending: readonly OptimisticMessage[]): { pendingMessages: OptimisticMessage[]; settledTurnKeys: string[] } {
  const settledTurnKeys = new Set(persisted.filter((message) => message.role === "user" && (["COMPLETED", "PARTIAL", "FAILED"] as const).includes(message.attachmentStatus as "COMPLETED" | "PARTIAL" | "FAILED")).map(({ turnKey }) => turnKey));
  if (!settledTurnKeys.size) return { pendingMessages: [...pending], settledTurnKeys: [] };
  const releasedTurnKeys = new Set<string>();
  const pendingMessages = pending.filter((message) => {
    const localOverlay = message.role === "user" && Boolean(message.turnKey) && message.attachments.some((attachment) => "local" in attachment);
    if (!localOverlay || !settledTurnKeys.has(message.turnKey!)) return true;
    releasedTurnKeys.add(message.turnKey!);
    return false;
  });
  return { pendingMessages, settledTurnKeys: [...releasedTurnKeys] };
}

export function replaceTurnMessages(messages: readonly OptimisticMessage[], userMessage: OptimisticMessage, assistantMessage: OptimisticMessage, optimisticKeys: readonly string[]) {
  const terminalAttachmentStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED"]);
  const preserveTerminalAttachmentVersion = (incoming: OptimisticMessage) => {
    const incomingIdentity = turnRoleIdentity(incoming);
    if (incoming.attachmentStatus !== "PENDING" || !incomingIdentity) return incoming;
    return messages.find((message) => turnRoleIdentity(message) === incomingIdentity && terminalAttachmentStatuses.has(message.attachmentStatus)) ?? incoming;
  };
  const resolvedUserMessage = preserveTerminalAttachmentVersion(userMessage);
  const resolvedAssistantMessage = preserveTerminalAttachmentVersion(assistantMessage);
  const authoritativeIdentities = new Set([turnRoleIdentity(resolvedUserMessage), turnRoleIdentity(resolvedAssistantMessage)].filter(Boolean));
  const withoutOptimistic = messages.filter((message) => !optimisticKeys.includes(message.key) && message.key !== resolvedUserMessage.key && message.key !== resolvedAssistantMessage.key && !authoritativeIdentities.has(turnRoleIdentity(message)));
  return [...withoutOptimistic, resolvedUserMessage, resolvedAssistantMessage];
}

export type RemovedConversationMessages = {
  pages: { pageIndex: number; messages: ConversationMessage[] }[];
};

export function removeConversationMessages(data: InfiniteData<ConversationMessagePage> | undefined, remove: (message: ConversationMessage) => boolean) {
  if (!data) return { data, removed: { pages: [] } satisfies RemovedConversationMessages };
  const removedPages: RemovedConversationMessages["pages"] = [];
  const pages = data.pages.map((page, pageIndex) => {
    const removed = page.messages.filter(remove);
    if (!removed.length) return page;
    removedPages.push({ pageIndex, messages: removed });
    return { ...page, messages: page.messages.filter((message) => !remove(message)) };
  });
  return { data: removedPages.length ? { ...data, pages } : data, removed: { pages: removedPages } };
}

export function restoreConversationMessages(data: InfiniteData<ConversationMessagePage> | undefined, removed: RemovedConversationMessages) {
  if (!data || !removed.pages.length) return data;
  const byPage = new Map(removed.pages.map((page) => [page.pageIndex, page.messages]));
  const pages = data.pages.map((page, pageIndex) => {
    const restoring = byPage.get(pageIndex);
    if (!restoring?.length) return page;
    const messages = [...new Map([...page.messages, ...restoring].map((message) => [message.key, message])).values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key));
    return { ...page, messages };
  });
  return { ...data, pages };
}
