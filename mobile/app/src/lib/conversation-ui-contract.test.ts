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
  expect(ui).toContain('paragraph: { textAlign: "right" as const }');
  expect(ui).toContain('userMessage: { alignItems: "flex-end"');
  expect(ui).toContain('styles={user ? USER_MESSAGE_RICH_TEXT_STYLES : undefined}');
});

test("restores only cached selection on app open and greets without fetching latest chat", () => {
  expect(uiState).toContain('AgentGreetingOccasion = "onboarding" | "returning"');
  expect(uiState).toContain('AgentGreetingRequestPolicy = "restore-or-greet" | "fresh"');
  expect(uiState).toContain('policy = "fresh"');
  expect(onboarding).toContain('requestAgentGreeting("onboarding")');
  expect(ui).toContain("state.agentGreetingRequest");
  expect(ui).toContain("consumeAgentGreeting(greetingRequest.id)");
  expect(ui).toContain("if (!request) return");
  expect(ui).toContain("!routeFocused || !coreFocused || !greetingRequest");
  expect(ui).toContain('request.policy === "restore-or-greet" ? await restoreConversationSelection() : "empty"');
  expect(ui).toContain('restoreResult === "restored" || restoreResult === "suppressed"');
  expect(ui).toContain("requestAgentGreeting(context, request.occasion");
  expect(ui).toContain('conversationKey: "ephemeral"');
  expect(ui).toContain('role: "assistant", status: "PENDING"');
  expect(ui).toContain("setCoreOpenRequest((current) => current + 1)");
  expect(ui).toContain("openRequest={greetingRequest?.id ?? coreOpenRequest}");
  expect(ui).not.toContain("if (greetingMessage) { setGreetingMessage(undefined)");
  expect(shared).toContain("useState(openRequest > 0)");
  expect(shared).toContain("useLayoutEffect(() => {");
  expect(shared).toContain("if (openRequest <= handledOpenRequestRef.current) return");
  const openRequestEffect = shared.slice(shared.indexOf("useLayoutEffect(() => {"));
  expectBefore(openRequestEffect, "handledOpenRequestRef.current = openRequest", "onFocusChangeRef.current?.(true)");
  const onboardingCompletion = onboarding.slice(onboarding.indexOf("const handleComplete"));
  expectBefore(onboardingCompletion, 'requestAgentGreeting("onboarding")', 'router.replace("/capability/archive")');
  expect(ui).toContain("selectionRestoreGeneration.current += 1");
  expect(ui).toContain("restoreGeneration !== selectionRestoreGeneration.current");
  expect(ui).toContain('type ConversationRestoreResult = "restored" | "empty" | "suppressed"');
  const restore = ui.slice(ui.indexOf('async function restoreConversationSelection()'), ui.indexOf('function openSheet('));
  expect(restore).toContain('const cached = await readConversationSelection(capturedContext)');
  expect(restore).toContain('if (!cached) return "empty"');
  expect(restore).not.toContain('listConversations');
  expect(restore).not.toContain('fetchQuery');
  expect(restore).toContain('setSelected(cached); selectedRef.current = cached');
  expectBefore(restore, 'if (selectedRef.current) return "restored"', 'await readConversationSelection');
  const selection = ui.slice(ui.indexOf('function selectConversation('), ui.indexOf('function beginConversationCreation('));
  expect(selection).toContain('selectionRestoreGeneration.current += 1');
  expect(greetingClient).toContain('transport("/agent/greeting"');
  expect(greetingClient).not.toContain("createConversation");
  const submit = ui.slice(ui.indexOf("async function submit("));
  expectBefore(submit, "const existing = selectedRef.current", "const operation = !existing");
  expect(submit.match(/beginConversationCreation\(openingGreeting\)/g)).toHaveLength(1);
  expect(ui.indexOf("requestAgentGreeting(context")).toBeLessThan(ui.indexOf("async function submit("));
});

test("fences restore and greeting work when Core closes", () => {
  expect(ui).toContain("const coreFocusGeneration = useRef(0)");
  expect(ui).toContain("const coreFocusedRef = useRef(false)");
  expect(ui).toContain("const focusGeneration = ++coreFocusGeneration.current");
  expect(ui).toContain("focusGeneration === coreFocusGeneration.current && coreFocusedRef.current");
  expect(ui).toContain("focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current");
  const closed = ui.slice(ui.indexOf("if (!focused) {"), ui.indexOf("if (useUiStore.getState().agentGreetingRequest"));
  expect(closed).toContain("clearGreetingState()");
  expect(closed).not.toContain("beginConversationCreation");
  expect(ui).toContain("if (ephemeralDraft.current)");
  expect(ui).toContain('requestAgentGreeting("returning")');
});

test("keeps New chat ephemeral until exactly one lazy creation on submit", () => {
  const openNewChat = ui.slice(ui.indexOf("function openNewChat()"), ui.indexOf("function dismissFailedMessages"));
  expect(openNewChat).toContain("clearConversationState()");
  expect(openNewChat).toContain("setSelected(undefined)");
  expect(openNewChat).toContain("rememberConversation(undefined)");
  expect(openNewChat).toContain("ephemeralDraft.current = true");
  expect(openNewChat).toContain('requestAgentGreeting("returning")');
  expect(openNewChat).not.toContain("beginConversationCreation");
  expect(openNewChat).not.toContain("createConversation");
  const submit = ui.slice(ui.indexOf("async function submit("), ui.indexOf("function updateSelectedConversationsFavorite"));
  expectBefore(submit, "clearGreetingState()", "beginConversationCreation(openingGreeting)");
  expectBefore(submit, "ephemeralDraft.current = false", "beginConversationCreation(openingGreeting)");
  expect(submit.match(/beginConversationCreation\(openingGreeting\)/g)).toHaveLength(1);
  const creation = ui.slice(ui.indexOf("function beginConversationCreation"), ui.indexOf("function openNewChat"));
  expect(creation).not.toContain("addConversationToUnfilteredLists");
  expectBefore(submit, 'if (event.type === "start")', "addConversationToUnfilteredLists(queryClient, capturedContext, active)");
});

test("renders persisted topics, submits them directly, and loads opening topics after the greeting", () => {
  expect(client).toContain('z.literal("NONE")');
  expect(client).toContain('z.literal("PENDING")');
  expect(client).toContain('z.literal("READY")');
  expect(client).toContain('z.literal("FAILED")');
  expect(ui).toContain('message.guideTopics.status === "PENDING"');
  expect(ui).toContain('message.guideTopics.status === "READY"');
  expect(ui).toContain('showGuideTopics={item.role === "assistant" && item.status === "COMPLETED"}');
  expect(ui).toContain('accessibilityLiveRegion="polite"');
  expect(ui).toContain('pressLabel={`Ask: ${topic.label}`}');
  expect(ui).toContain('<ActionPill compact disabled={message.guideTopics.status !== "READY"} key={topic.key}');
  expect(ui).toContain('submit({ content: topic.question, guideTopicSelection:');
  expect(ui).toContain("const renderMessage = useCallback<ListRenderItem<DisplayMessage>>");
  expect(ui).not.toContain("setInput(topic.question)");
  expect(ui).toContain("const submittedAttachments = direct ? []");
  expect(ui).toContain("if (!direct) setInput");
  expect(ui).toContain("...(direct ? { guideTopicSelection: direct.guideTopicSelection } : {})");
  expect(ui).toContain('const { messageKey, message, showReferralCodeAction, topicsPending, persistenceToken } = await requestAgentGreeting');
  expect(ui).toContain("content: current.content + event.text");
  expect(ui).toContain('guideTopics: topicsPending ? { status: "PENDING" } : { status: "NONE" }');
  expect(ui).toContain("await requestAgentGreetingTopics(context, persistenceToken, (event) => {");
  expect(ui).toContain("streamingGuideTopics: [...(current.streamingGuideTopics ?? []), event.topic]");
  expect(ui).toContain('disabled={message.guideTopics.status !== "READY"}');
  expect(ui).toContain('guideTopics: { status: "READY", topics: generated.topics }');
  expect(ui).toContain('guideTopics: openingGreeting.guideTopics.status === "READY" ? openingGreeting.guideTopics : { status: "NONE" }');
  expect(ui).toContain('if (openingGreeting) stopGreetingGeneration()');
  expect(ui).toContain('greetingMessageRef.current?.key === openingGreeting.key');
  expect(ui).not.toContain("persistedGuideTopics");
  const greetingEffect = ui.slice(ui.indexOf('const loadingKey = `agent-greeting-'), ui.indexOf('function handleCoreFocusChange'));
  expectBefore(greetingEffect, "await restoreConversationSelection()", 'status: "PENDING"');
  expect(greetingEffect).toContain('restoreResult === "restored" || restoreResult === "suppressed"');
  expect(ui).toContain("focusOnOpenRequest={false}");
  expect(ui).toContain('error.name === "CancelledError"');
  expect(greetingClient).toContain("z.array(guideTopicSchema).length(3)");
  expect(greetingClient).toContain("postEventStream");
  expect(greetingClient).toContain("requestAgentGreetingWithTransport");
  expect(greetingClient).toContain("requestAgentGreetingTopicsWithTransport");
  expect(greetingClient).not.toContain("apiClient.post");
  expect(greetingClient).not.toContain("/agent/guide-topics");
  const submit = ui.slice(ui.indexOf("async function submit("), ui.indexOf("function updateSelectedConversationsFavorite"));
  expectBefore(submit, "clearGreetingState()", "const submittedAttachments = direct ? []");
});

test("renders an immediately visible inverted timeline with bounded pagination and stable anchoring", () => {
  expect(client).toContain("CONVERSATION_PAGE_SIZE = 25");
  expect(client).toContain("CONVERSATION_MESSAGE_PAGE_SIZE = 10");
  expect(ui).toContain("const timelineMessages = useMemo(() => [...messages].reverse(), [messages])");
  expect(ui).toContain("data={timelineMessages}");
  expect(ui).toContain("inverted ItemSeparatorComponent");
  expect(ui).toContain("onEndReached={fetchOlderMessages}");
  expect(ui).toContain("onEndReachedThreshold={0.25}");
  expect(ui).toContain("maintainVisibleContentPosition={PRESERVE_MESSAGE_POSITION}");
  const messageSkeletons = ui.match(/function MessageSkeletons\([\s\S]*?\n\}/)?.[0] ?? "";
  expect(messageSkeletons.match(/<Skeleton style=\{\[styles\.messageSkeleton/g)).toHaveLength(2);
  expect(ui).toContain('function InitialMessageSkeletons()');
  expect(ui).toContain('<MessageSkeletons accessibilityLabel="Loading messages" />');
  expect(ui).toContain('messagesLoading ? <InitialMessageSkeletons />');
  expect(ui).not.toContain("messageListReady");
  expect(ui).not.toContain("messageListPreparingOverlay");
  expect(ui).not.toContain("messageListRevealTimer");
  expect(ui).toContain('isFetchingOlderMessages ? <OlderMessageSkeletons />');
  expect(ui).toContain("styles.assistantRow");
  expect(ui).toContain("styles.userRow");
  expect(ui).toContain('assistantRow: { justifyContent: "flex-start", paddingRight: spacing.lg, gap: spacing.sm }');
  expect(ui).toContain('userRow: { justifyContent: "flex-end", paddingLeft: 52 }');
  expect(ui).toContain('messageSkeleton: { height: 18, marginTop: 3, borderRadius: radii.sm }');
  expect(ui).toContain("initialNumToRender={10}");
  expect(ui).not.toContain("initialScrollIndex=");
  expect(ui).not.toContain('key={selected?.key ?? "ephemeral"}');
  expect(ui).toContain("maxToRenderPerBatch={10}");
  expect(ui).toContain("renderItem={renderMessage}");
  expect(ui).toContain("const MessageRow = memo(");
  expect(ui).toContain("appendDelta(assistantMessageKey, event.text)");
  expect(ui).toContain("ref={mountMessageList}");
  expect(ui).toContain("nearBottom.current = true");
  expect(ui).toContain("scheduleScrollToEnd(false)");
  expect(ui).toContain("scrollToOffset({ animated: request.animated, offset: 0 })");
  const scrollScheduler = ui.slice(ui.indexOf("const scheduleScrollToEnd"), ui.indexOf("const submitGuideTopic ="));
  expectBefore(scrollScheduler, "if (!request || !listRef.current) return", "pendingScroll.current = undefined");
  expect(scrollScheduler).not.toContain("nearBottom.current = true");
  expect(ui).toContain("ItemSeparatorComponent={MessageSeparator}");
  expect(ui).toContain('messageSeparator: { height: spacing.md }');
  expect(ui).toContain("ListFooterComponent={olderMessagesHeader}");
  expect(ui).toContain("ListHeaderComponent={<View style={styles.messageListFooter} />}");
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
  expect(ui).toContain("listRef.current?.scrollToOffset({ animated: false, offset: 0 })");
  expect(ui).not.toContain("keyboardFocusScrollTimer");
  expect(ui).not.toContain("KeyboardSyncedMessageList");
  expect(ui).not.toContain("useAnimatedReaction");
  expect(ui).not.toContain("<Reanimated.FlatList");
  const focusHandler = ui.slice(ui.indexOf("function handleCoreFocusChange"), ui.indexOf("function addDraftAttachments"));
  expect(focusHandler).not.toContain("scheduleScrollToEnd");
  expect(focusHandler).not.toContain("nearBottom.current = true");
  expect(ui).not.toContain("releaseFollowLatest");
  expect(ui).not.toContain("followReleaseFrame");
  expect(ui).toContain("followLatest.current = false");
  expect(ui).not.toContain("initialScrollPending");
  expect(ui).not.toContain("scheduleScrollToEnd(!turning)");
  expect(ui).not.toContain("composerFocused.current || followLatest.current || nearBottom.current");
  expect(ui).toContain("onScrollBeginDrag={handleMessageScrollBeginDrag}");
  expect(ui).toContain("followLatest.current = false;");
  expect(ui.slice(ui.indexOf("const handleMessageScrollBeginDrag"))).toContain("nearBottom.current = false;");
  const turnCompletion = ui.slice(ui.indexOf("} finally {", ui.indexOf("async function submit(")), ui.indexOf("function updateSelectedConversationsFavorite"));
  expect(turnCompletion).not.toContain("scheduleScrollToEnd");
  expect(turnCompletion).toContain("setTurning(false); setTurnScrollRequest((current) => current + 1)");
  const submitTurn = ui.slice(ui.indexOf("async function submit("), ui.indexOf("function updateSelectedConversationsFavorite"));
  expect(submitTurn.match(/setTurnScrollRequest\(\(current\) => current \+ 1\)/g)).toHaveLength(2);
  const deltaHandler = submitTurn.slice(submitTurn.indexOf('event.type === "delta"'), submitTurn.indexOf('event.type === "done"'));
  expect(deltaHandler).not.toContain("scheduleScrollToEnd");
  expect(ui).toContain("if (turnBusy.current) return;");
  const turnDone = ui.slice(ui.indexOf('event.type === "done"'), ui.indexOf("const currentConversation"));
  expect(turnDone).not.toContain("cancelAnimationFrame(scrollFrame.current)");
  expect(ui).toContain("useLayoutEffect(() => {");
  expect(ui).toContain("if (!turnScrollRequest) return;");
  expect(ui).toContain("scheduleScrollToEnd(false);");
  expect(ui).not.toContain('Keyboard.addListener("keyboardDidShow"');
  expect(ui).not.toContain('onLayout={handleListLayout}');
  expect(ui).not.toContain('const handleListLayout');
  expect(ui).toContain("const latestMessageKey = messages.at(-1)?.key");
  expect(ui).toContain('turnKey ? `${turnKey}:${role}` : key');
  expect(ui).toContain('Image.prefetch(image.url, "memory-disk")');
  expect(ui).toContain('cachePolicy="memory-disk"');
  expect(ui).toContain('<StreamingRichText content={message.content} streaming={pending} styles={user ? USER_MESSAGE_RICH_TEXT_STYLES : undefined} />');
  expect(ui).toContain("[latestMessageKey, scheduleScrollToEnd]");
});

test("provides Archive-rhythm header menus and complete chats/edit/delete sheets with shared controls", () => {
  expect(shared).toContain("pageActions?: ReactNode");
  expect(sharedWeb).toContain("{pageActions}");
  expect(ui).toContain('accessibilityLabel="Open chats"');
  expect(ui).toContain('accessibilityLabel="Current chat menu"');
  expect(ui).toContain('title="Chats"');
  for (const label of ["New chat", "Edit", "Unfavorite", "Favorite", "Delete", "Save", "Close"]) expect(ui).toContain(label);
  expect(ui).toContain("editInput.current?.focus(), 300");
  expect(ui).toContain('accessibilityLabel="Favorite chat"');
  expect(ui).toContain('sheetActionText: { width: "100%", textAlign: "center" }');
  expect(ui).not.toContain("loading={mutating}");
  expect(ui).not.toContain("<Pressable");
  expect(ui).not.toContain("<Touchable");
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
  expect(ui).toContain("await queryClient.cancelQueries({ queryKey, exact: true })");
  expect(ui).toContain("removeConversationMessages(queryClient.getQueryData(queryKey)");
  expect(ui).toContain("restoreConversationMessages(data, optimistic.removed)");
  expectBefore(ui, "queryClient.setQueryData(queryKey", "deleteConversationMessage(capturedContext");
  expectBefore(ui, "setSelectedMessage(undefined); openSheet(undefined);", "deleteConversationMessage(capturedContext");
  const messageDelete = ui.slice(ui.indexOf("function confirmMessageDelete"), ui.indexOf("async function openSearchHistory"));
  expect(messageDelete).not.toContain("invalidateQueries");
  expect(messageDelete).not.toContain("const previous = queryClient.getQueryData");
  expect(ui).not.toContain("deletingMessage");
  expect(client).toContain('/messages/${encodeURIComponent(keys.messageKey)}');
});

test("provides a Core-header chat menu with optimistic edit and confirmed delete flows", () => {
  const pageActions = ui.slice(ui.indexOf("const pageActions ="), ui.indexOf("const chatsInitialError"));
  expectBefore(pageActions, 'accessibilityLabel="Open chats"', 'accessibilityLabel="Current chat menu"');
  expect(pageActions).toContain("onPress={() => openConversationActions(selected)}");
  expect(ui).not.toContain('actionLabel={`Open ${item.name} menu`}');
  expect(ui).not.toContain('onAction={() => openConversationActions(item)}');
  expect(ui).toContain('open={sheet === "current" && Boolean(actionConversation)} title=""');
  expect(ui).toContain('onPress={openConversationEdit}');
  expect(ui).toContain('focusKey="editConversation"');
  expect(ui).toContain('editInput.current?.focus(), 300');
  expect(ui).toContain('accessibilityLabel="Favorite chat"');
  expect(ui).toContain('onPress={saveConversationEdit}');
  expect(ui).not.toContain('onPress={saveConversationEdit} loading=');
  expectBefore(ui, 'replaceConversationInMatchingLists(queryClient, capturedContext, optimistic)', 'await updateConversation(capturedContext, current.key');
  expect(ui).toContain('open={sheet === "delete" && Boolean(actionConversation)} title="Delete chat?"');
  expectBefore(ui, 'removeConversationFromLists(queryClient, capturedContext, deleted.key)', 'await deleteConversation(capturedContext, deleted.key');
});

test("provides optimistic bulk chat favorite and confirmed delete actions above the list", () => {
  expect(ui).toContain('onLongPress={() => handleConversationLongPress(item)}');
  expect(ui).toContain('accessibilityLabel="Selected chat toolbar"');
  expectBefore(ui, "{chatBulkToolbar}", "{chatsLoading ?");
  expect(ui).toContain('open={sheet === "bulkActions" && selectedConversations.length > 0}');
  expect(ui).toContain('{allSelectedConversationsFavorite ? "Unfavorite" : "Favorite"}');
  expect(ui).toContain('open={sheet === "bulkDelete" && selectedConversations.length > 0}');
  expect(ui).toContain('title={`Delete ${selectedConversations.length} ${selectedConversations.length === 1 ? "chat" : "chats"}?`}');
  expectBefore(ui, "replaceConversationInMatchingLists(queryClient, capturedContext, optimistic)", "await updateConversation(capturedContext, conversation.key");
  expectBefore(ui, "removeConversationFromLists(queryClient, capturedContext, conversation.key)", "await deleteConversation(capturedContext, conversation.key");
  expect(ui).toContain("restoreConversationToLists(queryClient, outcome.conversation");
  expect(ui).toContain("restoreConversationToLists(queryClient, conversation");
  const bulkSheets = ui.slice(ui.indexOf('open={sheet === "bulkActions"'), ui.indexOf('open={sheet === "filter"'));
  expect(bulkSheets).not.toContain("loading=");
  expect(bulkSheets).not.toContain("disabled=");
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
  expect(ui).toContain('!loaded && !failed ? <Skeleton accessibilityLabel={imageKey ? "Loading generated image" : "Generating image"}');
  expect(ui).toContain('<View style={styles.generatedImageFrame}>');
  expect(ui).not.toContain('if (!imageKey || isPending) return <View style={styles.generatedImageFrame}>');
  expect(ui).toContain('accessible={interactive}');
  expect(ui).toContain('onPress={interactive ? () => onOpenActions(message) : undefined}');
  expect(ui).toContain('renderKey: loadingKey');
  expect(ui).toContain('message.status === "COMPLETED" && message.imageSummaryText');
  expect(ui).toContain('<StreamingRichText content={message.imageSummaryText} streaming={false} />');
  for (const label of ["Retry older messages", "Retry more chats", "Messages could not be loaded.", "Chats could not be loaded."]) expect(ui).toContain(label);
  expect(ui).toContain("isConversationNotFoundError(messagesQuery.error)");
  expect(ui).toContain("writeConversationSelection(context, undefined)");
  expect(ui).toContain("queryClient.removeQueries({ queryKey: conversationQueryKeys.messages(context, stale.key), exact: true })");
  expect(ui).toContain("showToast");
  expect(ui).toContain("CONVERSATION_MESSAGE_MAX_LENGTH");
  expect(ui).toContain("CONVERSATION_NAME_MAX_LENGTH");
  expect(ui).toContain("if (!direct && draftRevision.current === submittedDraftRevision) setInput(content)");
  expect(ui).toContain('import { StreamingRichText } from "@vorinthex/shared/ui/rich-text";');
  expect(ui).toContain('<StreamingRichText content={message.content} streaming={pending} styles={user ? USER_MESSAGE_RICH_TEXT_STYLES : undefined} />');
  expect(streamingRichText).toContain("advanceStreamingRichText(state.current, content)");
  expect(streamingRichText).not.toContain("Animated.timing");
  expect(streamingRichText).not.toContain("opacity.setValue");
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
  expect(ui).not.toContain("followLatest.current = true");
  expect(ui).not.toContain("releaseFollowLatest()");
  expect(ui).toContain('event.type === "start"');
  expect(ui).toContain('event.type === "delta"');
  expect(ui).toContain('event.type === "done"');
  expect(ui).toContain("appendDelta(assistantMessageKey, event.text)");
  expect(ui).not.toContain("deltaFlushMs");
  expect(ui).toContain("deltaBuffer.current.set");
  expect(ui).toContain("deltaFrame.current = requestAnimationFrame");
  expect(ui).toContain("clearBufferedDeltas()");
  expect(ui).toContain("![optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey].includes(key)");
  expect(ui).toContain("conversationQueryKeys.messages(capturedContext, activeConversation.key)");
  expect(ui).toContain("<ChromeIcon");
  expect(ui).toContain('assistantMessage: { minWidth: 0, flex: 1, backgroundColor: "transparent" }');
  expect(ui).toContain('userMessage: { alignItems: "flex-end", backgroundColor: "transparent" }');
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
  expect(ui).toContain('alwaysBounceHorizontal={false}');
  const attachmentPills = ui.slice(ui.indexOf("const attachmentPills ="), ui.indexOf("const modeSelector ="));
  expect(attachmentPills).not.toContain('appearance="plain"');
  expect(ui).toContain('style={styles.attachmentPillsScroll}');
  expect(ui).toContain('compact dense disabled={turning} fitContent');
  expect(ui).toContain('attachmentPillsScroll: { flexGrow: 0, flexShrink: 0, height: 28 }');
  expect(ui).toContain('attachmentPill: { backgroundColor: palette.page, flexShrink: 0, maxWidth: 158 }');
  expect(ui).toContain('attachmentName: { color: palette.text, flexShrink: 1, fontSize: 11, maxWidth: 88 }');
  expect(shared).toContain('{expanded && expandedAccessory ? <View style={styles.expandedAccessory}>{expandedAccessory}</View> : null}');
  expect(ui).not.toContain('attachmentRemove:');
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
  expect(ui).toContain('<ActionPill compact dense fitContent style={[styles.attachmentPill, styles.messageAttachmentPill]}><View style={styles.attachmentPillContent}><FileIcon');
  expect(ui).toContain('<ActionPill compact dense fitContent onPress={() => onOpen(attachment)} pressLabel={`Open actions for ${displayAttachmentFilename(attachment.filename)}`} style={[styles.attachmentPill, styles.messageAttachmentPill]}');
  expect(ui).toContain('messageAttachmentPill: { alignSelf: "flex-end" }');
  const messageAttachment = ui.slice(ui.indexOf("function MessageAttachment"), ui.indexOf("function isExpectedCancellation"));
  expectBefore(messageAttachment, 'if (attachment.kind === "image") return <ConversationImageAttachment', 'if ("local" in attachment) return <ActionPill');
  const optimisticDocument = messageAttachment.slice(messageAttachment.indexOf('if ("local" in attachment)'), messageAttachment.indexOf('return <ActionPill compact dense fitContent onPress'));
  expect(optimisticDocument).not.toContain("onPress=");
  expect(optimisticDocument).not.toContain("onAction=");
  expect(optimisticDocument).not.toContain("action=");
  expect(messageAttachment.match(/style=\{styles\.attachmentName\}/g)).toHaveLength(2);
  expect(messageAttachment.match(/styles\.messageAttachmentPill/g)).toHaveLength(2);
  expect(ui).toContain("recyclingKey={displayKey}");
  expect(ui).toContain("key={conversationAttachmentDisplayKey(attachment)}");
  expect(cache).toContain("attachment.displayKey ?? attachment.key");
  const completedTurnStart = ui.indexOf('} else if (event.type === "done")');
  const completedTurn = ui.slice(completedTurnStart, ui.indexOf('}, controller.signal);', completedTurnStart));
  expect(completedTurn).toContain('turnBusy.current = false; setTurning(false);');
  expect(ui).toContain('setSelectedAttachment(attachment); setSheet("attachmentActions")');
  const attachmentActions = ui.slice(ui.indexOf('open={sheet === "attachmentActions"'), ui.indexOf('open={sheet === "imageActions"'));
  expect(attachmentActions.match(/<BottomSheetItem/g)).toHaveLength(1);
  expect(attachmentActions).toContain("Open file");
  expect(ui).toContain('slug: "archive", documentKey: attachment.key');
  expect(ui).toContain('slug: "gallery", imageKey: attachment.key');
  expect(ui).toContain("galleryImageCollectionKey(image)");
  expect(ui).toContain("galleryQueryKeys.image(galleryContext, collectionKey, image.key)");
  expect(ui).toContain("galleryQueryKeys.overview(galleryContext, collectionKey)");
  expect(ui).toContain("fetchGalleryOverview(collectionKey, undefined, 100)");
  expect(ui).toContain('...(collectionKey ? { assetKey: collectionKey } : {})');
  expect(ui).toContain('attachment.kind === "image" ? <ImageIcon');
  expect(ui).toContain('displayAttachmentFilename(attachment.filename)');
  expect(ui).toContain('decodeURIComponent(filename.replace(/\\+/g, "%20"))');
  expect(ui).toContain("deleteTemporaryFile(removed.uri)");
  expect(ui).toContain("normalizeCapturedJpeg(asset, { maxSide: 1600, compress: 0.82 }");
  expect(ui).toContain("<BrandedCameraModal");
  expect(ui).toContain("showCaptureLoading={false}");
  expectBefore(ui.slice(ui.indexOf("function captureImage")), "setCameraOpen(false)", "normalizeCapturedJpeg(picture, { maxSide: 1600, compress: 0.82 }");
  expect(ui).toContain('uri: picture.uri, kind: "image", preparing: true');
  expect(ui).toContain('filename: `capture-${Date.now()}.jpg`, mimeType: "image/jpeg"');
  expect(ui).toContain('messageAttachmentImageButton: { minHeight: 0, width: 144');
  expect(ui).toContain('messageAttachmentImage: { width: "100%", height: 88');
  expect(ui).not.toContain("<Pressable");
  expect(ui).toContain('thinkingText: { flex: 1 }');
  expect(ui).not.toContain('thinkingText: { flex: 1, marginTop: 3 }');
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
  expect(ui).toContain('>Image</Button>');
  expect(ui).toContain('mode === "image" ? ["Generate image..."]');
  expect(ui).not.toContain('Describe an image, or keep chatting.');
  expect(ui).toContain('<Tabs accessibilityLabel="Core mode" accessibilityRole="tablist"');
  expect(ui).toContain('modeRow: { alignItems: "center" }');
  expect(ui).toContain('<StreamingRichText content={imageProgressText(message.content)} streaming={false} style={pending ? styles.loadingTextRaised : undefined} />');
  expect(ui).toContain('loadingTextRaised: { transform: [{ translateY: -3 }] }');
  expect(ui).toContain('typeof JSON.parse(content) === "object" ? "Image generation is in progress." : content');
  expect(ui).toContain('accessibilityLabel={imageKey ? "Loading generated image" : "Generating image"}');
  expect(ui).toContain('Image generation failed.');
  expect(ui).not.toContain('enqueueConversationImageTurn');
  expect(ui).not.toContain('mode === "image") { void submitImage(content); return; }');
  expect(ui).not.toContain('>Describe an image, or keep chatting.</Text>');
  expect(ui).not.toContain('"Ask anything, including for images."');
  expect(ui).toContain("disabled={!configured || attachmentsPreparing || turning}");
  expect(ui).toContain("editable={configured && !turning && !sheet}");
  expect(ui).toContain("loading={turning}");
  expect(ui).not.toContain("loading={greetingPending || turning}");
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
  expect(shared).toContain('{expanded && expandedAccessory ? <View style={styles.expandedAccessory}>{expandedAccessory}</View> : null}');
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
  expect(ui).toContain('open={sheet === "chats" || sheet === "filter" || sheet === "bulkActions" || sheet === "bulkDelete"} title="Chats"');
  expect(ui).toContain('<ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear chat search"');
  expect(ui).toContain('accessibilityLabel="Search chats" autoFocusInBottomSheet={false}');
  expect(ui).toContain('open={sheet === "filter"}');
  expect(ui).toContain('accessibilityLabel="Show favorite chats only"');
  expect(ui).not.toContain('accessibilityLabel="Chat group"');
  expect(ui).not.toContain("chatGroupTabs");
  expect(ui).toContain('favoriteOnly: false, recordHistory: true');
  expect(ui).toContain('.filter((conversation) => !favoriteOnly || conversation.isFavorite)');
  expect(ui).not.toContain('<Badge><Text style={styles.favoriteMark}>Favorite</Text></Badge>');
});

test("uses haptics and selected styling for chat bulk selection without pill checkmarks", () => {
  expect(ui).toContain('import * as Haptics from "expo-haptics"');
  expect(ui).toContain("void Haptics.selectionAsync()");
  expect(ui).toContain("style={selectedChat ? styles.chatPillSelected : undefined}");
  expect(ui).not.toContain('selectedChat ? <CheckIcon');
});

test("uses one selection haptic when each discrete Core output finishes", () => {
  expect(ui).toContain("function notifyCoreOutput() { void Haptics.selectionAsync(); }");
  expect(ui).not.toContain("greetingHapticSent");
  expect(ui).toContain("streamingGuideTopics: [...(current.streamingGuideTopics ?? []), event.topic]");
  expect(ui).not.toContain("responseHapticSent");
  const openingTopicStream = ui.slice(ui.indexOf("const generated = await requestAgentGreetingTopics"), ui.indexOf("const ready: DisplayMessage"));
  expectBefore(openingTopicStream, "streamingGuideTopics: [...(current.streamingGuideTopics ?? []), event.topic]", "notifyCoreOutput();");
  expect(ui).toContain('if (event.message.status === "PENDING") pendingImageHapticKeys.current.add(event.message.key)');
  expect(ui).toContain('if (message.status === "COMPLETED") notifyCoreOutput();');
  expect(ui).toContain('if (event.message.guideTopics.status === "PENDING") pendingTopicHapticKeys.current.add(event.message.key)');
  expect(ui).toContain('if (message.guideTopics.status === "READY") notifyCoreOutput();');
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
  expect(ui).not.toContain('messageList: { flexGrow: 1, justifyContent: "flex-end"');
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
  expect(ui).toContain('style={[styles.generatedImageOverlay, styles.skeletonCard]}');
});
