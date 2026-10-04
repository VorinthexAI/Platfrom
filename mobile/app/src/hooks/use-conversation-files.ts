import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { findContentFile, listContentInventoryPage, type ContentContext, type ContentFile } from "@/lib/content-client";
import type { ConversationFileView } from "@/lib/conversation-retrievals";

export function useConversationFiles(context: ContentContext, view?: ConversationFileView) {
  const inventory = useInfiniteQuery({
    queryKey: ["conversation-file-inventory", context.userKey, context.scopeKey, view?.inventory],
    queryFn: ({ pageParam, signal }) => listContentInventoryPage(context, { ...view?.inventory, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.cursor,
    enabled: Boolean(view?.inventory && context.userKey && context.scopeKey),
  });
  const selected = useQuery({
    queryKey: ["conversation-selected-files", context.userKey, context.scopeKey, view?.keys],
    queryFn: async ({ signal }) => (await Promise.all((view?.keys ?? []).map((key) => findContentFile(key, context, signal).catch(() => undefined)))).filter((file): file is ContentFile => Boolean(file) && !file!.isHidden),
    enabled: Boolean(view && !view.inventory && context.userKey && context.scopeKey),
  });
  const paged = Boolean(view?.inventory);
  return {
    files: paged ? [...new Map(inventory.data?.pages.flatMap((page) => page.files).map((file) => [file.key, file]) ?? []).values()] : selected.data ?? [],
    loading: paged ? inventory.isPending : selected.isPending,
    error: paged ? inventory.isError && !inventory.data : selected.isError,
    loadingMore: paged && inventory.isFetchingNextPage,
    moreError: paged && inventory.isFetchNextPageError,
    hasMore: paged && Boolean(inventory.hasNextPage),
    loadMore: () => { if (paged && inventory.hasNextPage && !inventory.isFetchingNextPage) void inventory.fetchNextPage(); },
    refresh: () => paged ? inventory.refetch() : selected.refetch(),
  };
}
