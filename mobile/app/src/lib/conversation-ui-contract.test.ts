import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [ui, client, cache, bridge, shared, sharedWeb, appSearch] = await Promise.all([
  read("../components/PersistentCoreComposer.tsx"),
  read("./conversation-client.ts"),
  read("./conversation-cache.ts"),
  read("./event-bridge.tsx"),
  read("../../../../shared/packages/ui/components/core-composer/core-composer.mobile.tsx"),
  read("../../../../shared/packages/ui/components/core-composer/core-composer.web.tsx"),
  read("./app-search-client.ts"),
]);

test("keeps the chat controller single and shared by all five mobile workspaces", async () => {
  for (const workspace of ["KnowledgeWorkspace", "GalleryWorkspace", "TravelWorkspace", "EmailWorkspace", "AscendWorkspace"]) {
    const source = await read(`../components/capability/${workspace}.tsx`);
    expect(source).toContain('PersistentCoreComposer as CoreComposer');
  }
  expect(ui).toContain("export function PersistentCoreComposer");
});

test("implements upward 25-message pagination with anchor preservation and exactly two directional skeletons", () => {
  expect(client).toContain("CONVERSATION_PAGE_SIZE = 25");
  expect(ui).toContain("contentOffset.y < 180");
  expect(ui).toContain("maintainVisibleContentPosition={{ minIndexForVisible: 0 }}");
  const olderSkeletons = ui.match(/function OlderMessageSkeletons\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  expect(olderSkeletons.match(/<Skeleton style=\{\[styles\.messageSkeleton/g)).toHaveLength(2);
  expect(ui).toContain("styles.assistantRow");
  expect(ui).toContain("styles.userRow");
  expect(ui).toContain('assistantRow: { justifyContent: "flex-start", paddingRight: 52 }');
  expect(ui).toContain('userRow: { justifyContent: "flex-end", paddingLeft: 52 }');
});

test("provides Archive-rhythm header menus and complete chats/edit/delete sheets with shared controls", () => {
  expect(shared).toContain("pageActions?: ReactNode");
  expect(sharedWeb).toContain("{pageActions}");
  expect(ui).toContain('accessibilityLabel="Core new menu"');
  expect(ui).toContain('accessibilityLabel="Current chat menu"');
  expect(ui).toContain(">Chats</BottomSheetItem>");
  for (const label of ["New chat", "Edit", "Unfavorite", "Favorite", "Delete", "Save", "Close"]) expect(ui).toContain(label);
  expect(ui).toContain("editInput.current?.focus(), 300");
  expect(ui).not.toContain("<Pressable");
  expect(ui).not.toContain("<Touchable");
});

test("shows immediate search/loading skeletons and uses 300ms request plus 800ms history debounce", () => {
  expect(ui).toContain("setSearchPending(true)");
  expect(ui).toContain("}, 300)");
  expect(ui).toContain("}, 800)");
  expect(ui).toContain("recordHistory: false");
  expect(ui).toContain("recordHistory: true");
  expect(appSearch).not.toContain('"conversations"');
  expect(ui).toContain("Array.from({ length: 3 }");
  expect(ui).toContain("styles.chatSkeletonPill");
  expect(ui).toContain("styles.chatNameSkeleton");
  expect(ui).not.toContain("No chats");
});

test("matches Archive search/filter/history controls without a hidden filter", () => {
  expect(ui).toContain("<FilterIcon");
  expect(ui).toContain("<Switch");
  expect(ui).toContain(">Favorites</Text>");
  expect(ui).toContain(">Search history</Button>");
  expect(ui).toContain("<SearchHistorySheet");
  expect(ui).not.toContain("Hidden");
});

test("renders lifecycle and failures without exposing the backend Pending placeholder", () => {
  expect(ui).toContain('message.status === "PENDING"');
  expect(ui).toContain('message.status === "FAILED"');
  expect(ui).toContain("This response could not be completed.");
  expect(ui).not.toContain('>Pending<');
  for (const label of ["Retry older messages", "Retry more chats", "Messages could not be loaded.", "Chats could not be loaded."]) expect(ui).toContain(label);
  expect(ui).toContain("showToast");
  expect(ui).toContain("CONVERSATION_MESSAGE_MAX_LENGTH");
  expect(ui).toContain("CONVERSATION_NAME_MAX_LENGTH");
});

test("guards stale/cancelled SSE, reconciles optimistic pairs, and bridges unified invalidation", () => {
  expect(client).toContain("streamConversationTurnWithTransport");
  expect(client).toContain("/turn/stream");
  expect(ui).toContain("turnGeneration.current");
  expect(ui).toContain("controller.signal.aborted");
  expect(ui).toContain("turnController.current?.abort()");
  expect(ui).toContain("identityRef.current = identity");
  expect(ui).toContain("isConversationContextCurrent(capturedIdentity, identityRef)");
  expect(ui).toContain("operationControllers.current");
  expect(ui).toContain("queryClient.cancelQueries");
  expect(ui).toContain('event.type === "start"');
  expect(ui).toContain('event.type === "delta"');
  expect(ui).toContain('event.type === "done"');
  expect(cache).toContain("replaceTurnMessages");
  expect(bridge).toContain('event.event === "conversation.changed"');
  expect(bridge).toContain("conversationQueryKeys.all(conversationContext)");
});
