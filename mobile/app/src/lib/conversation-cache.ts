import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

import type { Conversation, ConversationContext, ConversationMessage, ConversationMessagePage, ConversationPage } from "./conversation-client";

export type ConversationListFilter = { query: string; favoriteOnly: boolean };
const identity = (context: ConversationContext) => [context.userKey, context.organizationKey, context.scopeKey] as const;
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

export type OptimisticMessage = Omit<ConversationMessage, "turnKey" | "completedAt"> & { turnKey?: string; completedAt?: string; optimistic?: true };

export function replaceTurnMessages(messages: readonly OptimisticMessage[], userMessage: OptimisticMessage, assistantMessage: OptimisticMessage, optimisticKeys: readonly string[]) {
  const withoutOptimistic = messages.filter(({ key }) => !optimisticKeys.includes(key) && key !== userMessage.key && key !== assistantMessage.key);
  return [...withoutOptimistic, userMessage, assistantMessage];
}
