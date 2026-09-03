import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [ui, client, cache, bridge, shared, sharedWeb, appSearch, selectionVault] = await Promise.all([
  read("../components/PersistentCoreComposer.tsx"),
  read("./conversation-client.ts"),
  read("./conversation-cache.ts"),
  read("./event-bridge.tsx"),
  read("../../../../shared/packages/ui/components/core-composer/core-composer.mobile.tsx"),
  read("../../../../shared/packages/ui/components/core-composer/core-composer.web.tsx"),
  read("./app-search-client.ts"),
  read("./conversation-selection-vault.ts"),
]);

function expectBefore(source: string, first: string, second: string) {
  expect(source.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
}

test("keeps the chat controller single and shared by all five mobile workspaces", async () => {
  for (const workspace of ["KnowledgeWorkspace", "GalleryWorkspace", "TravelWorkspace", "EmailWorkspace", "AscendWorkspace"]) {
    const source = await read(`../components/capability/${workspace}.tsx`);
    expect(source).toContain('PersistentCoreComposer as CoreComposer');
  }
  expect(ui).toContain("export function PersistentCoreComposer");
});

test("implements bounded upward message pagination with anchor preservation and exactly two thin initial skeletons", () => {
  expect(client).toContain("CONVERSATION_PAGE_SIZE = 25");
  expect(client).toContain("CONVERSATION_MESSAGE_PAGE_SIZE = 10");
  expect(ui).toContain("contentOffset.y < 180");
  expect(ui).toContain("maintainVisibleContentPosition={{ minIndexForVisible: 0 }}");
  const messageSkeletons = ui.match(/function MessageSkeletons\([\s\S]*?\n\}/)?.[0] ?? "";
  expect(messageSkeletons.match(/<Skeleton style=\{\[styles\.messageSkeleton/g)).toHaveLength(2);
  expect(ui).toContain('function InitialMessageSkeletons()');
  expect(ui).toContain('<MessageSkeletons accessibilityLabel="Loading messages" />');
  expect(ui).toContain('messagesLoading ? <InitialMessageSkeletons />');
  expect(ui).toContain('isFetchingOlderMessages ? <OlderMessageSkeletons />');
  expect(ui).toContain("styles.assistantRow");
  expect(ui).toContain("styles.userRow");
  expect(ui).toContain('assistantRow: { justifyContent: "flex-start", paddingRight: spacing.lg, gap: spacing.sm }');
  expect(ui).toContain('userRow: { justifyContent: "flex-end", paddingLeft: 52 }');
  expect(ui).toContain('messageSkeleton: { height: 18, marginTop: 3, borderRadius: radii.sm }');
  expect(ui).toContain("initialNumToRender={10}");
  expect(ui).toContain("maxToRenderPerBatch={10}");
  expect(ui).toContain("renderItem={renderMessage}");
  expect(ui).toContain("const MessageRow = memo(");
  expect(ui).toContain("queueDelta(assistantMessageKey, event.text)");
  expect(ui).toContain("ref={mountMessageList}");
  expect(ui).toContain("initialScrollPending.current = true");
  expect(ui).toContain("nearBottom.current = true");
  expect(ui).toContain("scheduleScrollToEnd(false)");
  expect(ui).toContain("scrollToEnd({ animated: request.animated })");
  expect(ui).toContain('ListFooterComponent={<View style={styles.messageListFooter} />}');
  expect(ui).toContain("ItemSeparatorComponent={MessageSeparator}");
  expect(ui).toContain('messageSeparator: { height: spacing.md }');
  expect(ui).toContain('messageListFooter: { height: spacing.xl }');
  expect(ui).not.toContain('messageList: { flexGrow: 1, paddingBottom: spacing.sm');
  expect(ui).toContain("pendingScroll.current = { animated }");
  expect(ui).toContain("scrollSettleTimer.current = setTimeout");
  expect(ui).toContain("listRef.current?.scrollToEnd({ animated: false })");
  expect(ui).toContain("releaseFollowLatest()");
  expect(ui).toContain("cancelAnimationFrame(followReleaseFrame.current)");
  expect(ui).toContain("if (initialScrollPending.current) return;");
  expect(ui).toContain("followLatest.current = true");
  expect(ui).toContain("composerFocused.current || followLatest.current || nearBottom.current");
});

test("provides Archive-rhythm header menus and complete chats/edit/delete sheets with shared controls", () => {
  expect(shared).toContain("pageActions?: ReactNode");
  expect(sharedWeb).toContain("{pageActions}");
  expect(ui).toContain('accessibilityLabel="Open chats"');
  expect(ui).toContain('accessibilityLabel="Current chat menu"');
  expect(ui).toContain(">Chats</Button>");
  for (const label of ["New chat", "Edit", "Unfavorite", "Favorite", "Delete", "Save", "Close"]) expect(ui).toContain(label);
  expect(ui).toContain("editInput.current?.focus(), 300");
  expect(ui).toContain('accessibilityLabel="Favorite chat"');
  expect(ui).toContain('sheetActionText: { width: "100%", textAlign: "center" }');
  expect(ui).not.toContain("loading={mutating}");
  expect(ui).not.toContain("<Pressable");
  expect(ui).not.toContain("<Touchable");
  expect(ui).toContain("readConversationSelection(capturedContext)");
  expect(ui).toContain("rememberConversation(conversation)");
  expect(selectionVault).toContain("WHEN_UNLOCKED_THIS_DEVICE_ONLY");
  expect(selectionVault).toContain("context.userKey}.${context.organizationKey}.${context.scopeKey}");
  expect(ui).toContain('onOpenActions={openMessageActions}');
  expect(ui).toContain('open={sheet === "messageActions"}');
  expect(ui).toContain('>Delete message</BottomSheetItem>');
  expect(ui).toContain('title="Delete message?"');
  expect(ui).not.toContain('selected message and its paired question or response');
  expect(ui).toContain('deleteConversationMessage(capturedContext, conversation.key, message.key, controller.signal)');
  expectBefore(ui, "queryClient.setQueryData(queryKey", "deleteConversationMessage(capturedContext");
  expectBefore(ui, "setSelectedMessage(undefined); openSheet(undefined);", "deleteConversationMessage(capturedContext");
  expect(ui).not.toContain("deletingMessage");
  expect(client).toContain('/messages/${encodeURIComponent(keys.messageKey)}');
});

test("shows immediate search/loading skeletons and uses 300ms request plus 800ms history debounce", () => {
  expect(ui).toContain("setSearchPending(true)");
  expect(ui).toContain("}, 300)");
  expect(ui).toContain("}, 800)");
  expect(ui).toContain("recordHistory: false");
  expect(ui).toContain("recordHistory: true");
  expect(appSearch).not.toContain('"conversations"');
  expect(ui).toContain("Array.from({ length: 3 }");
  expect(ui).toContain("styles.chatSkeleton");
  expect(ui).toContain("No chats yet.");
  expect(ui).toContain("No chats matched this search.");
  expect(ui).toContain("No favorite chats.");
  expect(ui).toContain("chatsQuery.isPending && chatsQuery.isFetching");
  expect(ui).toContain("messagesQuery.isPending && messagesQuery.isFetching");
  expect(ui).toContain("messageEmpty ? null");
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
  expect(ui).toContain('<LoadingText style={styles.thinkingText} text={image ? "Generating image..." : "Thinking..."} />');
  for (const label of ["Retry older messages", "Retry more chats", "Messages could not be loaded.", "Chats could not be loaded."]) expect(ui).toContain(label);
  expect(ui).toContain("isConversationNotFoundError(messagesQuery.error)");
  expect(ui).toContain("writeConversationSelection(context, undefined)");
  expect(ui).toContain("queryClient.removeQueries({ queryKey: conversationQueryKeys.messages(context, stale.key), exact: true })");
  expect(ui).toContain("showToast");
  expect(ui).toContain("CONVERSATION_MESSAGE_MAX_LENGTH");
  expect(ui).toContain("CONVERSATION_NAME_MAX_LENGTH");
  expect(ui).not.toContain("setInput(content)");
  expect(ui).toContain('import { RichText } from "@vorinthex/shared/ui/rich-text";');
  expect(ui).toContain('<RichText content={message.content} />');
  expect(ui).not.toContain("renderMessageContent");
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
  expect(ui).toContain('Keyboard.addListener("keyboardDidShow"');
  expect(ui).toContain("composerFocused.current = focused");
  expect(ui).toContain("followLatest.current = true");
  expect(ui).toContain("releaseFollowLatest()");
  expect(ui).toContain('event.type === "start"');
  expect(ui).toContain('event.type === "delta"');
  expect(ui).toContain('event.type === "done"');
  expect(ui).toContain("![optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey].includes(key)");
  expect(ui).toContain("conversationQueryKeys.messages(capturedContext, activeConversation.key)");
  expect(ui).toContain("<ChromeIcon");
  expect(ui).toContain('assistantMessage: { minWidth: 0, flex: 1, backgroundColor: "transparent" }');
  expect(ui).toContain('userMessage: { backgroundColor: "transparent" }');
  expect(ui).toContain("ChatBubbleIcon");
  expect(cache).toContain("replaceTurnMessages");
  expect(bridge).toContain('event.event === "conversation.changed"');
  expect(bridge).toContain("conversationQueryKeys.all(conversationContext)");
});

test("keeps Core attachments transient and uploads them only through the persisted conversation send path", () => {
  for (const label of ["Upload images", "Upload files", "Capture image"]) expect(ui).toContain(label);
  expect(ui).not.toMatch(/<BottomSheetItem[^>]*><(Image|File|Camera)Icon/);
  expect(ui).toContain("expandedLeading={<PlusIcon");
  expect(ui).toContain("expandedAccessory={attachmentPills}");
  expect(ui).toContain("expandedFooter={modeSelector}");
  expect(shared).toContain("expandedAccessory?: ReactNode");
  expect(shared).toContain("expandedLeading?: ReactNode");
  expect(ui).toContain("activeConversation = operation ? await operation.promise : existing");
  expect(ui).toContain("await uploadConversationAttachments(capturedContext, active.key, requestKey, submittedAttachments");
  expect(ui).toContain("attachmentKeys, referenceImageKeys:");
  expect(ui).toContain("clearSentAttachments(submittedAttachments)");
  expect(ui).toContain("draftAttachmentsRef.current = []");
  expect(ui).toContain("setDraftAttachments([])");
  expect(ui).toContain("restoreSentAttachments(submittedAttachments)");
  expect(ui).toContain('attachment.kind === "image" ? <ImageIcon');
  expect(ui).toContain("deleteTemporaryFile(removed.uri)");
  expect(ui).toContain("normalizeCapturedPng(asset");
  expect(ui).toContain("<BrandedCameraModal");
  expect(ui).not.toContain("<Pressable");
});

test("keeps Core modes presentational while Core chooses chat or image generation", () => {
  expect(client).toContain('/image-turns`');
  expect(client).toContain('type: z.enum(["TEXT", "IMAGE"])');
  expect(client).toContain('kind: type === "IMAGE" ? "image"');
  expect(client).toContain("imageKey: z.string().cuid().optional()");
  expect(ui).toContain('type ComposerMode = "chat" | "image"');
  expect(ui).toContain('>Chat</Button>');
  expect(ui).toContain('>Images</Button>');
  expect(ui).toContain('mode === "image" ? ["Generate image..."]');
  expect(ui).not.toContain('Describe an image, or keep chatting.');
  expect(ui).toContain('<Tabs accessibilityLabel="Core mode" accessibilityRole="tablist"');
  expect(ui).toContain('modeRow: { alignItems: "center" }');
  expect(ui).toContain('text={image ? "Generating image..." : "Thinking..."}');
  expect(ui).toContain('Image generation failed.');
  expect(ui).not.toContain('enqueueConversationImageTurn');
  expect(ui).not.toContain('mode === "image") { void submitImage(content); return; }');
  expect(ui).not.toContain('>Describe an image, or keep chatting.</Text>');
  expect(ui).not.toContain('"Ask anything, including for images."');
  expect(ui).toContain('disabled={!configured || turning}');
  expect(ui).toContain('expandedLeadingAccessibilityLabel="Add attachment"');
  expect(ui).toContain('maxLength={CONVERSATION_MESSAGE_MAX_LENGTH}');
  expect(ui).not.toContain("capabilityIconSource");
  expect(ui).toContain('source={assistantIconSource}');
  expect(ui).toContain("dismissedFailedKeys.current.add(message.key)");
  expect(ui).toContain('status === "FAILED" && dismissedFailedKeys.current.has(key)');
  expect(ui).toContain('modeTab: { flex: 1 }');
  expect(ui).toContain('modeTabs: { width: "100%",');
  expect(ui).toContain('Keyboard.addListener("keyboardDidHide", scrollAfterKeyboardChange)');
  expect(ui).toContain('source={assistantIconSource}');
  expect(ui).not.toContain('capabilityIconSource.gallery');
  expect(ui).toContain('<GeneratedConversationImage');
  expect(ui).toContain('queryKey: ["conversation-generated-image-v2", contextIdentity, imageKey]');
  expect(ui).toContain('expandedAccessory={attachmentPills}');
  expect(ui).toContain('expandedFooter={modeSelector}');
  expect(ui).not.toContain('composerAccessory');
  expect(shared).toContain('expanded && (expandedAccessory || expandedFooter)');
});

test("offers generated-image actions and one replaceable edit reference without forcing image mode", () => {
  expect(ui).toContain('accessibilityLabel="Open generated image actions"');
  expect(ui).toContain('open={sheet === "imageActions" && Boolean(selectedGeneratedImageKey)}');
  expect(ui).toContain('>Edit image</BottomSheetItem>');
  expect(ui).toContain('>Open image</BottomSheetItem>');
  expect(ui).toContain('setEditReferenceImageKey(selectedGeneratedImageKey)');
  expect(ui).toContain('>Image to edit</Text>');
  expect(ui).toContain('expandedPrompts={editReferenceImageKey ? ["Edit this image..."] : mode === "image" ? ["Generate image..."] : undefined}');
  expect(ui).toContain('referenceImageKeys: submittedReferenceImageKey ? [submittedReferenceImageKey] : []');
  expect(ui).toContain('...(assetKey ? { assetKey } : {})');
  expect(ui).toContain('...(assetKey ? { assetKey } : {})');
  expect(client).toContain('referenceImageKeys?: string[]');
  expect(shared).toContain('expandedPrompts?: readonly string[]');
});

test("keeps Chats beneath the bottom-opening filter and preserves a compact search clear control", () => {
  expect(ui).toContain('open={sheet === "chats" || sheet === "filter"} title="Chats"');
  expect(ui).toContain('<ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear chat search"');
  expect(ui).toContain('accessibilityLabel="Search chats" autoFocusInBottomSheet={false}');
  expect(ui).toContain('open={sheet === "filter"}');
  expect(ui).toContain('<Tabs accessibilityLabel="Chat group" accessibilityRole="tablist"');
  expect(ui).toContain('>Favorites</Button>');
  expect(ui).toContain('favoriteOnly: false, recordHistory: true');
  expect(ui).toContain('.filter((conversation) => !favoriteOnly || conversation.isFavorite)');
  expect(ui).not.toContain('<Badge><Text style={styles.favoriteMark}>Favorite</Text></Badge>');
});

test("shows a persistent branded Core watermark without flashing message skeletons for a new chat", () => {
  expect(ui).toContain("function ConversationWatermark()");
  expect(ui).toContain(">Core</Text>");
  expect(ui).toContain(">Your personal AI agent connecting Vorinthex AI</Text>");
  expect(ui).toContain('glow={0.5} size={104}');
  expect(ui).toContain('<Text style={styles.coreWatermarkText}>Core</Text>');
  expect(ui).toContain('<View style={styles.coreWatermarkMark}><ChromeIcon');
  expect(ui).toContain('coreWatermarkMark: { marginVertical: spacing.xs, opacity: 0.3 }');
  expect(ui).toContain('messageList: { flexGrow: 1, zIndex: 1 }');
  expect(ui).not.toContain('emptyCoreCard:');
  expect(ui).toContain("<ConversationWatermark />");
  expect(ui).toContain("messageEmpty ? null");
  expectBefore(ui, "queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, created.key)", "setSelected((value)");
});

test("focuses the composer for image edits and uses the Archive card skeleton treatment", () => {
  expect(ui).toContain("setComposerFocusRequest((current) => current + 1)");
  expect(ui).toContain("focusRequest={composerFocusRequest}");
  expect(shared).toContain("focusRequest?: number");
  expect(shared).toContain("focusRequest <= handledFocusRequestRef.current");
  expect(shared).toContain("const CORE_EDIT_FOCUS_DELAY_MS = 300");
  expect(ui).toContain('style={[styles.generatedImage, styles.skeletonCard]}');
});
