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
const [greetingClient, uiState, onboarding] = await Promise.all([
  read("./agent-greeting-client.ts"),
  read("../state/ui.ts"),
  read("../app/onboarding.tsx"),
]);
const streamingRichText = await read("../../../../shared/packages/ui/components/rich-text/rich-text.mobile.tsx");

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

test("opens with an ephemeral generated greeting and creates a chat only after the first reply", () => {
  expect(uiState).toContain('AgentGreetingOccasion = "onboarding" | "returning"');
  expect(onboarding).toContain('requestAgentGreeting("onboarding")');
  expect(ui).toContain("state.agentGreetingRequest");
  expect(ui).toContain("consumeAgentGreeting(greetingRequest.id)");
  expect(ui).toContain("if (!request) return");
  expect(ui).toContain("!routeFocused || !greetingRequest");
  expect(ui).toContain("requestAgentGreeting(context, request.occasion");
  expect(ui).toContain('conversationKey: "ephemeral"');
  expect(ui).toContain('role: "assistant", status: "PENDING"');
  expect(ui).toContain("setCoreOpenRequest((current) => current + 1)");
  expect(ui).toContain("openRequest={greetingRequest?.id ?? coreOpenRequest}");
  expect(ui).toContain('const greetingPending = Boolean(greetingRequest) || greetingMessage?.status === "PENDING"');
  expect(ui).not.toContain("if (greetingMessage) { setGreetingMessage(undefined)");
  expect(shared).toContain("useState(openRequest > 0)");
  expect(shared).toContain("useLayoutEffect(() => {");
  const onboardingCompletion = onboarding.slice(onboarding.indexOf("const handleComplete"));
  expectBefore(onboardingCompletion, 'requestAgentGreeting("onboarding")', 'router.replace("/capability/archive")');
  expect(ui).toContain("selectionRestoreIdentity.current = identity");
  expect(ui).toContain("selectionRestoreGeneration.current += 1");
  expect(ui).toContain("restoreGeneration !== selectionRestoreGeneration.current");
  expect(greetingClient).toContain('apiClient.post("/agent/greeting"');
  expect(greetingClient).not.toContain("createConversation");
  const submit = ui.slice(ui.indexOf("async function submit()"));
  expectBefore(submit, "const existing = selectedRef.current", "const operation = !existing");
  expect(ui.indexOf("requestAgentGreeting(context")).toBeLessThan(ui.indexOf("async function submit()"));
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
  expect(ui).toContain("appendDelta(assistantMessageKey, event.text)");
  expect(ui).toContain("ref={mountMessageList}");
  expect(ui).toContain("initialScrollPending.current = true");
  expect(ui).toContain("nearBottom.current = true");
  expect(ui).toContain("scheduleScrollToEnd(false)");
  expect(ui).toContain("scrollToEnd({ animated: request.animated })");
  expect(ui).toContain("ItemSeparatorComponent={MessageSeparator}");
  expect(ui).toContain('messageSeparator: { height: spacing.md }');
  expect(ui).toContain("ListFooterComponent={<View style={styles.messageListFooter} />}");
  expect(ui).toContain("messageListFooter: { height: 24 }");
  expect(ui).toContain("removeClippedSubviews={false}");
  expect(shared).not.toContain("pageContent: {\n    flex: 1,\n    gap: spacing.md,");
  expect(shared).not.toContain('marginBottom: spacing.md');
  expect(ui).toContain('conversation: { flex: 1, minHeight: 0, position: "relative" }');
  expect(ui).not.toContain('messageList: { flexGrow: 1, paddingBottom: spacing.sm');
  expect(ui).toContain("pendingScroll.current = { animated }");
  expect(ui).toContain("const scheduleScrollToEnd = useCallback((animated: boolean, settle = !animated)");
  expect(ui).toContain("if (settle) {");
  expect(ui).toContain("scrollSettleTimer.current = setTimeout");
  expect(ui).toContain("listRef.current?.scrollToEnd({ animated: false })");
  expect(ui).not.toContain("keyboardFocusScrollTimer");
  expect(ui).not.toContain("KeyboardSyncedMessageList");
  expect(ui).not.toContain("useAnimatedReaction");
  expect(ui).not.toContain("<Reanimated.FlatList");
  const focusHandler = ui.slice(ui.indexOf("function handleCoreFocusChange"), ui.indexOf("function addDraftAttachments"));
  expect(focusHandler).not.toContain("scheduleScrollToEnd");
  expect(focusHandler).not.toContain("nearBottom.current = true");
  expect(ui).toContain("releaseFollowLatest()");
  expect(ui).toContain("cancelAnimationFrame(followReleaseFrame.current)");
  expect(ui).toContain("if (initialScrollPending.current) return;");
  expect(ui).toContain("followLatest.current = true");
  expect(ui).toContain("else if (followLatest.current || nearBottom.current)");
  expect(ui).not.toContain("composerFocused.current || followLatest.current || nearBottom.current");
  expect(ui).toContain("onScrollBeginDrag={handleMessageScrollBeginDrag}");
  expect(ui).toContain("followLatest.current = false;");
  expect(ui.slice(ui.indexOf("const handleMessageScrollBeginDrag"))).toContain("nearBottom.current = false;");
  expect(ui).toContain("if (!followLatest.current) return;");
  expect(ui).not.toContain('Keyboard.addListener("keyboardDidShow"');
  expect(ui).not.toContain('onLayout={handleListLayout}');
  expect(ui).not.toContain('const handleListLayout');
  expect(ui).toContain("const latestMessageKey = messages.at(-1)?.key");
  expect(ui).toContain('turnKey ? `${turnKey}:${role}` : key');
  expect(ui).toContain('Image.prefetch(image.url, "memory-disk")');
  expect(ui).toContain('cachePolicy="memory-disk"');
  expect(ui).toContain('<StreamingRichText content={message.content} streaming={pending} />');
  expect(ui).toContain("[latestMessageKey, scheduleScrollToEnd]");
});

test("provides Archive-rhythm header menus and complete chats/edit/delete sheets with shared controls", () => {
  expect(shared).toContain("pageActions?: ReactNode");
  expect(sharedWeb).toContain("{pageActions}");
  expect(ui).toContain('accessibilityLabel="Open chats"');
  expect(ui).not.toContain('accessibilityLabel="Current chat menu"');
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
  expect(selectionVault).toContain("context.userKey}.${context.teamKey}.${context.scopeKey}");
  expect(ui).toContain('onOpenActions={openMessageActions}');
  expect(ui).toContain('open={sheet === "messageActions"}');
  expect(ui).toContain('NativeShare.share({ message }, { dialogTitle: "Share message" })');
  expectBefore(ui, '>Share message</BottomSheetItem>', '>Delete message</BottomSheetItem>');
  expect(ui).not.toContain("sharingMessage");
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
  expect(ui).toContain('image && !user && !failed');
  expect(ui).toContain('<GeneratedConversationImage contextIdentity={contextIdentity} imageKey={message.imageKey}');
  expect(ui).toContain('onLoad={() => setLoadedUrl(image.url)}');
  expect(ui).toContain('!loaded ? <Skeleton accessibilityLabel="Loading generated image"');
  expect(ui).toContain('<View style={styles.generatedImageFrame}>');
  expect(ui).toContain('message.status === "COMPLETED" && message.imageSummaryText');
  expect(ui).toContain('<StreamingRichText content={message.imageSummaryText} streaming={false} />');
  for (const label of ["Retry older messages", "Retry more chats", "Messages could not be loaded.", "Chats could not be loaded."]) expect(ui).toContain(label);
  expect(ui).toContain("isConversationNotFoundError(messagesQuery.error)");
  expect(ui).toContain("writeConversationSelection(context, undefined)");
  expect(ui).toContain("queryClient.removeQueries({ queryKey: conversationQueryKeys.messages(context, stale.key), exact: true })");
  expect(ui).toContain("showToast");
  expect(ui).toContain("CONVERSATION_MESSAGE_MAX_LENGTH");
  expect(ui).toContain("CONVERSATION_NAME_MAX_LENGTH");
  expect(ui).toContain("if (draftRevision.current === submittedDraftRevision) setInput(content)");
  expect(ui).toContain('import { StreamingRichText } from "@vorinthex/shared/ui/rich-text";');
  expect(ui).toContain('<StreamingRichText content={message.content} streaming={pending} />');
  expect(streamingRichText).toContain("advanceStreamingRichText(state.current, content)");
  expect(streamingRichText).toContain("opacity.setValue(0.82)");
  expect(streamingRichText).toContain("duration: 90");
  expect(streamingRichText).not.toContain("setTimeout");
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
  expect(ui).toContain("followLatest.current = true");
  expect(ui).toContain("releaseFollowLatest()");
  expect(ui).toContain('event.type === "start"');
  expect(ui).toContain('event.type === "delta"');
  expect(ui).toContain('event.type === "done"');
  expect(ui).toContain("appendDelta(assistantMessageKey, event.text)");
  expect(ui).not.toContain("deltaFlushMs");
  expect(ui).not.toContain("deltaBuffer");
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

test("uploads Core attachments through persisted sends and reconciles them to durable resources", () => {
  for (const label of ["Upload images", "Upload files", "Capture image"]) expect(ui).toContain(label);
  expect(ui).not.toMatch(/<BottomSheetItem[^>]*><(Image|File|Camera)Icon/);
  expect(ui).toContain("expandedLeading={<PlusIcon");
  expect(ui).toContain("expandedAccessory={attachmentPills}");
  expectBefore(ui, "addDraftAttachments(selected.map", "await mapWithConcurrency(selected.filter");
  expect(ui).toContain("preparing: true as const");
  expect(ui).toContain("attachmentsPreparing");
  expect(ui).toContain("expandedFooter={modeSelector}");
  expect(shared).toContain("expandedAccessory?: ReactNode");
  expect(shared).toContain("expandedLeading?: ReactNode");
  expect(ui).toContain("activeConversation = operation ? await operation.promise : existing");
  expect(ui).toContain("await uploadConversationAttachments(capturedContext, active.key, requestKey, submittedAttachments");
  expect(ui).toContain("attachmentKeys, referenceImageKeys:");
  expect(client).toContain('attachmentStatus: z.enum(["NONE", "PENDING", "COMPLETED", "PARTIAL", "FAILED"])');
  expect(ui).toContain("submittedAttachmentTurns.current.set(requestKey, submittedAttachments)");
  expect(ui).toContain("settlePendingAttachmentOverlays(persistedMessages, pendingMessages)");
  expect(ui).toContain("deleteSubmittedAttachmentFiles(turnKey)");
  expect(ui).not.toContain("clearSentAttachments(submittedAttachments)");
  expect(ui).toContain("draftAttachmentsRef.current = []");
  expect(ui).toContain("setDraftAttachments([])");
  expect(ui).toContain("restoreSentAttachments(requestKey, submittedAttachments)");
  expect(client).toContain("conversationAttachmentReferenceSchema");
  expect(client).toContain("userMessage: serverConversationMessageSchema");
  expect(ui).not.toContain("? { ...event.userMessage, attachments: message.attachments, optimistic: true }");
  expect(ui).toContain("<ConversationImageAttachment");
  expect(ui).toContain('slug: "archive", documentKey: attachment.key');
  expect(ui).toContain('slug: "gallery", imageKey: attachment.key');
  expect(ui).toContain('attachment.kind === "image" ? <ImageIcon');
  expect(ui).toContain('displayAttachmentFilename(attachment.filename)');
  expect(ui).toContain('decodeURIComponent(filename.replace(/\\+/g, "%20"))');
  expect(ui).toContain("deleteTemporaryFile(removed.uri)");
  expect(ui).toContain("normalizeCapturedPng(asset");
  expect(ui).toContain("<BrandedCameraModal");
  expect(ui).toContain("showCaptureLoading={false}");
  expectBefore(ui.slice(ui.indexOf("function captureImage")), "setCameraOpen(false)", "normalizeCapturedPng(picture");
  expect(ui).toContain('uri: picture.uri, kind: "image", preparing: true');
  expect(ui).toContain('messageAttachmentImageButton: { minHeight: 0, width: 144');
  expect(ui).toContain('messageAttachmentImage: { width: "100%", height: 88');
  expect(ui).not.toContain("<Pressable");
});

test("keeps search results closable and every Core send icon white", async () => {
  const retrievalSheet = await read("../components/ConversationRetrievalSheet.tsx");
  expect(retrievalSheet).toContain('footer={<Button onPress={onClose} size="md" variant="secondary">Close</Button>}');
  for (const component of ["AccountScreenShell", "capability/KnowledgeWorkspace", "capability/GalleryWorkspace", "capability/TravelWorkspace", "capability/EmailWorkspace", "capability/AscendWorkspace"]) {
    const source = await read(`../components/${component}.tsx`);
    expect(source).not.toContain('sendIcon={<SendIcon size="sm" variant="inverse" />}');
  }
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
  expect(ui).toContain('<StreamingRichText content={imageProgressText(message.content)} streaming={false} />');
  expect(ui).toContain('typeof JSON.parse(content) === "object" ? "Image generation is in progress." : content');
  expect(ui).toContain('accessibilityLabel={imageKey ? "Loading generated image" : "Generating image"}');
  expect(ui).toContain('Image generation failed.');
  expect(ui).not.toContain('enqueueConversationImageTurn');
  expect(ui).not.toContain('mode === "image") { void submitImage(content); return; }');
  expect(ui).not.toContain('>Describe an image, or keep chatting.</Text>');
  expect(ui).not.toContain('"Ask anything, including for images."');
  expect(ui).toContain("disabled={!configured || greetingPending || attachmentsPreparing || turning}");
  expect(ui).toContain('expandedLeadingAccessibilityLabel="Add attachment"');
  expect(ui).toContain('maxLength={CONVERSATION_MESSAGE_MAX_LENGTH}');
  expect(ui).not.toContain("capabilityIconSource");
  expect(ui).toContain('source={assistantIconSource}');
  expect(ui).toContain("dismissedFailedKeys.current.add(message.key)");
  expect(ui).toContain('status === "FAILED" && dismissedFailedKeys.current.has(key)');
  expect(ui).toContain('modeTab: { flex: 1 }');
  expect(ui).toContain('modeTabs: { width: "100%",');
  expect(ui).not.toContain('Keyboard.addListener("keyboardDidHide", scrollAfterKeyboardChange)');
  expect(ui).toContain('source={assistantIconSource}');
  expect(ui).not.toContain('capabilityIconSource.gallery');
  expect(ui).toContain('<GeneratedConversationImage');
  expect(ui).toContain('queryKey: ["conversation-generated-image-v2", contextIdentity, imageKey ?? "pending"]');
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

test("shows the branded Core watermark after messages load without flashing skeletons for a new chat", () => {
  expect(ui).toContain("function ConversationWatermark()");
  expect(ui).toContain(">Core</Text>");
  expect(ui).toContain(">Your personal AI for finding answers, natural conversation, and image creation across Vorinthex AI</Text>");
  expect(ui).toContain('glow={0.5} size={104}');
  expect(ui).toContain('<Text style={styles.coreWatermarkText}>Core</Text>');
  expect(ui).toContain('<View style={styles.coreWatermarkMark}><ChromeIcon');
  expect(ui).toContain('coreWatermarkMark: { marginVertical: spacing.xs, opacity: 0.3 }');
  expect(ui).toContain('messageList: { flexGrow: 1, zIndex: 1 }');
  expect(ui).not.toContain('emptyCoreCard:');
  expect(ui).toContain('pageBackdrop={<ConversationWatermark />}');
  expect(ui).not.toContain('<View style={styles.conversation}>\n    <ConversationWatermark />');
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
