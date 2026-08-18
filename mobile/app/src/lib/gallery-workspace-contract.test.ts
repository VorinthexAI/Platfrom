import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
const captureSource = await Bun.file(new URL("../components/capability/GalleryCaptureModal.tsx", import.meta.url)).text();
const cameraSource = await Bun.file(new URL("../components/capability/BrandedCameraModal.tsx", import.meta.url)).text();
const bottomSheetSource = await Bun.file(new URL("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx", import.meta.url)).text();
const sharingSource = await Bun.file(new URL("../components/capability/GalleryCollectionSharing.tsx", import.meta.url)).text();
const memberWebSource = await Bun.file(new URL("../../../../shared/packages/ui/icons/member/member.web.tsx", import.meta.url)).text();
const memberMobileSource = await Bun.file(new URL("../../../../shared/packages/ui/icons/member/member.mobile.tsx", import.meta.url)).text();
const webIconsSource = await Bun.file(new URL("../../../../shared/packages/ui/icons.ts", import.meta.url)).text();
const mobileIconsSource = await Bun.file(new URL("../../../../shared/packages/ui/icons-mobile.ts", import.meta.url)).text();

test("keeps image similarity collection-scoped and outside the image footer", () => {
  const footer = source.slice(source.indexOf('const sheetFooter ='), source.indexOf('return (', source.indexOf('const sheetFooter =')));
  expect(footer).not.toContain("Find similar");
  expect(source).toContain("imageKey: source.key, collectionKey: collection.key");
  expect(source).toContain("Image.prefetch(url)");
  expect(source).toContain("Similar to {similarSource.filename}");
  expect(source.indexOf(">Find similar image<")).toBeLessThan(source.indexOf(">Delete image<"));
});

test("uses four-column cursor grids and one skeleton row for initial and append loading", () => {
  expect(source).toContain("const IMAGE_COLUMNS = 4");
  expect(source).toContain("fetchGalleryOverview(collectionKey, cursor)");
  expect(source).toContain("Array.from({ length: IMAGE_COLUMNS }");
  expect(source).toContain("loadingMore ? <View style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }");
});

test("groups collection images by created date", () => {
  expect(source).toContain("groupGalleryImagesByCreatedDate<GalleryGridItem>");
  expect(source).toContain("createdAt: item.createdAt");
  expect(source).toContain('entry.kind === "optimistic"');
  expect(source).toContain("visibleImageGroups.map((group)");
  expect(source).toContain("styles.dateHeading");
});

test("provides edit and confirmed delete flows for images and collections", () => {
  expect(source).toContain('pushSheet("confirmDeleteImage")');
  expect(source).toContain('pushSheet("confirmDeleteCollection")');
  expect(source).toContain('activeSheet === "imageEdit"');
  expect(source).toContain('activeSheet === "collectionEdit"');
  expect(source).toContain('activeSheet === "duplicates"');
  const imageMenuStart = source.indexOf('activeSheet === "imageActions" && selectedImage');
  const imageMenu = source.slice(imageMenuStart, source.indexOf('activeSheet === "imageEdit"', imageMenuStart));
  expect(imageMenu).not.toContain('toggleFavorite');
  expect(imageMenu).not.toContain('openVisualIdentities');
});

test("uses a singleton collection cache without root search or filtering", () => {
  expect(source).toContain("getGalleryCollections(queryClient");
  expect(source).toContain("setCachedGalleryCollections");
  expect(source).not.toContain('accessibilityLabel="Search Gallery collections and images"');
  expect(source).not.toContain('accessibilityLabel="Filter Gallery"');
  expect(source).toContain('accessibilityLabel="Create in Gallery"');
});

test("only lifts Core for its own focus and uses distinct image sheet presentations", () => {
  expect(source).toContain('behavior={aiInputFocused ? "height" : undefined}');
  expect(source).toContain("setAiInputFocused(focused)");
  expect(source).toContain('hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions"}');
  expect(source).toContain('open={!sharingOpen && sheetOpen && (activeSheet === "image" || activeSheet === "imageActions") && Boolean(selectedImage || selectedOptimisticItem)}');
  expect(source).toContain("        mutation\n        onOpenChange");
  expect(source).toContain('mutation={activeSheet === "imageEdit"');
  expect(source).not.toContain('activeSheet === "imageActions" || activeSheet === "imageEdit"');
  expect(source).not.toContain("detailCaption");
  expect(source).toContain('accessibilityLabel="Open image actions"');
  expect(source).toContain('footer={<Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>}');
  expect(source).toContain('if (activeSheetRef.current === "imageActions") goBackSheet(); else closeSheet();');
  expect(source).toContain('detailImageFrame: { flex: 1, width: "100%", overflow: "hidden", borderRadius: radii.lg');
  expect(bottomSheetSource).toContain('mutationSheet: {\n    bottom: 0');
  expect(bottomSheetSource).toContain('Platform.OS === "android" ? insets.bottom : 0');
  expect(bottomSheetSource).toContain('bottom: mutation ? androidBottomInset');
  expect(bottomSheetSource).toContain('borderBottomLeftRadius: 24');
  expect(bottomSheetSource).toContain('borderBottomRightRadius: 24');
  expect(bottomSheetSource).not.toContain('height: mutation ? windowHeight - insets.top - androidBottomInset');
});

test("keeps collection forms to name and favorite state", () => {
  expect(source).toContain('accessibilityLabel="Collection name"');
  expect(source).toContain('accessibilityLabel="Favorite collection"');
  expect(source).not.toContain('accessibilityLabel="Collection description"');
});

test("provides the full visual identity library and image picker workflow", () => {
  expect(source).toContain('activeSheet === "visualIdentities"');
  expect(source).toContain('activeSheet === "identityPicker"');
  expect(source).toContain("Choose an image to create a visual identity from.");
  expect(source).toContain("Visual identities</Button>");
  expect(source).toContain("createGallerySubject(name, [image.key])");
  expect(source).toContain("identityKey: identity.key");
  expect(source).toContain("creatingIdentityKeys.includes(identity.key)");
  expect(source).toContain("setIdentityError(errorMessage(error))");
  expect(source).toContain("identitiesLoading || creatingIdentityKeys.length > 0");
  expect(source).toContain("Array.from({ length: COLLECTION_COLUMNS }");
});

test("uses separate image-selection and naming steps for visual identities", () => {
  expect(source).toContain('activeSheet === "identityName"');
  expect(source).toContain('imagePickerPurpose === "cover" ? chooseCollectionCover() : pushSheet("identityName")');
  expect(source).toContain('placeholder="Name"');
  expect(source).not.toContain("Name, for example Hugo");
  expect(source).toContain('accessibilityLabel="Choose a different visual identity image"');
  expect(source).toContain("returnToIdentityLibrary();");
  expect(source).toContain("width: 88, height: 88");
  expect(source).toContain('activeSheet === "identityName" && styles.fullSheetScroll');
  expect(source.indexOf('accessibilityLabel="Back to collections"')).toBeLessThan(source.indexOf('accessibilityLabel="Search images for visual identity"'));
});

test("supports direct empty-state upload and twelve removable camera captures", () => {
  expect(source).toContain('accessibilityLabel={`Upload images to ${activeCollection.name}`}');
  expect(source).toContain("<GalleryCaptureModal");
  expect(source).toContain('refetchType: "none"');
  expect(captureSource).toContain("MAX_GALLERY_CAPTURES = 12");
  expect(captureSource).toContain("normalizeCapturedJpeg");
  expect(captureSource).toContain("normalized.latitude");
  expect(captureSource).toContain("Remove image");
  expect(cameraSource).toContain("exif: true");
  expect(cameraSource).toContain('setFacing((current) => current === "back" ? "front" : "back")');
  expect(captureSource).toContain('hint=""');
  expect(source).toContain("showOptimisticImage(entry.item)");
  expect(source).toContain("Image.prefetch(image.url)");
  expect(source).toContain("!optimisticImageKeys.has(key)");
  expect(source).toContain("key: item.imageKey ?? item.clientKey");
  expect(source).toContain("current?.key === selected.clientKey && updated.imageKey");
  expect(source).not.toContain('accessibilityLabel="Processing image"');
  expect(source).not.toContain('`${matches.length} image${matches.length === 1 ? "" : "s"}${collection ? ` in ${collection.name}` : ""}.`');
});

test("allows duplicate exclusions and optimistic visual identity deletion", () => {
  expect(source).toContain('accessibilityLabel={`Keep ${image.filename}`}');
  expect(source).toContain('pushSheet("confirmDeleteIdentity")');
  expect(source).toContain("deleteGallerySubject(identity.key)");
  expect(source.indexOf("setSubjects((current) => current.filter")).toBeLessThan(source.indexOf("deleteGallerySubject(identity.key)"));
});

test("uses standard right-side close controls and hides collection menu headings", () => {
  const previewStart = source.indexOf("<BottomSheet");
  const preview = source.slice(previewStart, source.indexOf("\n      >", previewStart));
  const sheetStart = source.indexOf("<BottomSheet", previewStart + preview.length);
  const sheet = source.slice(sheetStart, source.indexOf("\n      >", sheetStart));
  expect(preview).toContain('title={selectedImage?.filename ?? selectedOptimisticItem?.filename ?? "Image"}');
  expect(sheet).toContain("title={sheetTitle}");
  expect(`${preview}${sheet}`).not.toContain("headerLeading");
  expect(`${preview}${sheet}`).not.toContain("headerTrailing");
  expect(`${preview}${sheet}`).not.toContain("hideCloseButton");
  expect(sheet).toContain('hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions"}');
});

test("gates collection search focus while the Core sheet closes", () => {
  expect(source).toContain("editable={!collectionSearchFocusBlocked}");
  expect(source).toContain("collectionSearchInput.current?.blur()");
  expect(source).toContain("onFocusChange={handleCoreFocusChange}");
  expect(source).toContain("setTimeout(() => setCollectionSearchFocusBlocked(false), 350)");
});

test("provides collection sharing navigation and permission gates", () => {
  expect(source).toContain(">My collections</Button>");
  expect(source).toContain(">Shared collections</Button>");
  expect(source).toContain("<MemberIcon size=\"sm\"");
  expect(source).toContain('collectionRole === "collaborator" && image.createdByKey === activeCollection.memberKey');
  expect(source).toContain('pushSheet("confirmLeaveCollection")');
  expect(sharingSource).toContain('>Members</BottomSheetItem>');
  expect(sharingSource).toContain('>Pending invites</BottomSheetItem>');
  expect(sharingSource).toContain('Array.from({ length: 3 }');
  expect(sharingSource).toContain('successTitle = "Share link copied to clipboard"');
  expect(sharingSource).toContain("showToast({ title, duration: 2_000 })");
  expect(sharingSource).toContain('setCachedGalleryShareLinks');
  expect(sharingSource).toContain('galleryQueryKeys.members(context, collection.key), exact: true, refetchType: "none"');
  expect(sharingSource).toContain('view === "memberRemoveConfirm"');
  expect(sharingSource).toContain('active === selectedLink.active');
  expect(source).toContain('open={!sharingOpen && sheetOpen');
  expect(source).toContain('access?.canContribute && role !== "viewer"');
  expect(source).not.toContain("GalleryPendingInvites");
  expect(source).not.toContain("pendingInvitesOpen");
  expect(source).not.toContain('accessibilityLabel="Pending Gallery invites"');
  expect(sharingSource).not.toContain("export function GalleryPendingInvites");
  expect(sharingSource).toContain('event.slug === "collection.access.changed"');
  expect(sharingSource).toContain('accessibilityLabel={`Remove ${selectedMember?.name ?? "member"} from collection`}');
  expect(sharingSource).not.toContain('<View accessible accessibilityHint=');
  expect(source).toContain('const [canCreateCollections, setCanCreateCollections] = useState(false)');
  expect(source).toContain('setCanCreateCollections(overview.canCreateCollections)');
  expect(source).toContain('collectionTab === "mine" && canCreateCollections');
  expect(source).toContain('activeCollection\n    ? isCollectionOwner');
});

test("restores the root create action and Archive-style ownership tabs", () => {
  expect(source).toContain('<Button accessibilityLabel="Create in Gallery" contentMode="raw" disabled={loading}');
  expect(source).toContain('<PlusIcon size="sm" />');
  expect(source).toContain('<Tabs accessibilityRole="tablist" style={styles.collectionTabs}>');
  expect(source).toContain('<Button accessibilityRole="tab" accessibilityState={{ selected: collectionTab === "mine" }}');
  expect(source).toContain('size="xs" style={styles.collectionTab} variant={collectionTab === "mine" ? "secondary" : "ghost"}>My collections</Button>');
  expect(source).toContain('size="xs" style={styles.collectionTab} variant={collectionTab === "shared" ? "secondary" : "ghost"}>Shared collections</Button>');
  expect(source).toContain('collectionTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel }');
});

test("exports a distinct person-outline member icon for collection access", () => {
  expect(webIconsSource).toContain("export * from './icons/member';");
  expect(mobileIconsSource).toContain('export * from "./icons/member/member.mobile";');
  for (const iconSource of [memberWebSource, memberMobileSource]) {
    expect(iconSource).toContain('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z');
    expect(iconSource).toContain('M4 21a8 8 0 0 1 16 0');
    expect(iconSource).not.toContain('M5 12h14');
    expect(iconSource).not.toContain('M12 5v14');
  }
});

test("filters root collections by authoritative ownership with a legacy fallback", () => {
  expect(source).toContain('collectionTab === "mine" ? isGalleryCollectionOwned(collection) : !isGalleryCollectionOwned(collection)');
});

test("edits owner collection covers from existing images with tri-state changes", () => {
  expect(source).toContain('const [editCoverImageKey, setEditCoverImageKey] = useState<string | null>()');
  expect(source).toContain('updateGalleryCollection(previous.key, editName.trim(), editFavorite, editCoverImageKey)');
  expect(source).toContain('setEditCoverImageKey(identityPickerSelected.key)');
  expect(source).toContain('setEditCoverImageKey(null)');
  expect(source).toContain('if (!activeCollection || !isCollectionOwner) return');
  expect(source).toContain('openIdentityPickerCollection(activeCollection)');
  expect(source).toContain('accessibilityLabel="Clear collection cover"');
});

test("uses covered collection cards in every collection browser and destination picker", () => {
  expect(source.match(/collection\.coverUrl \? <Image source=\{collection\.coverUrl\}/g)?.length).toBeGreaterThanOrEqual(4);
  expect(source.match(/collection\.coverUrl && styles\.coveredCollectionMain/g)?.length).toBeGreaterThanOrEqual(4);
  expect(source).toContain('accessibilityLabel={`Upload to ${collection.name}`}');
  expect(source).toContain('accessibilityLabel={`${selected ? "Remove" : "Select"} ${collection.name}`}');
  expect(source).toContain('openIdentityPickerCollection(collection)');
});

test("defers workspace and open sharing refreshes while mutations are busy", () => {
  expect(source).toContain('refreshCoalescer.current.takeIfReady(busyRef.current)');
  expect(source).toContain('if (!busy && refreshCoalescer.current.hasPending)');
  expect(sharingSource).toContain('deferredRefresh.current = true');
  expect(sharingSource).toContain('if (!rebound) setView("members")');
  expect(sharingSource).toContain('if (!rebound) setView("invites")');
  expect(sharingSource).toContain('if (!rebound) setView("links")');
});

test("generation-guards context changes and gates event network work", () => {
  expect(source).toContain("refreshContextGeneration.current += 1");
  expect(source).toContain("refreshCoalescer.current.reset()");
  expect(source).toContain("if (!isCurrent()) return");
  expect(source).toContain('const needsIndex = plan.has("root") || plan.has("access")');
  expect(source).toContain('if (!needsIndex && !needsOverview && !needsSubjects) return');
  expect(source).toContain("await replayOverviewWindow(activeCollection?.key, images.length, generation)");
});

test("reconciles permission downgrades and authoritatively guards submissions", () => {
  expect(source).toContain("reconcileGalleryPermissions");
  expect(source).toContain("if (permissions.closeSheet) closeSheet()");
  expect(source).toContain('latest?.role !== "owner" || !latest.access?.canManage');
  expect(source).toContain('!destination.access?.canContribute || destination.role === "viewer"');
  expect(source).toContain("selected.every((image) => canMutateInCollection(image, sourceCollection))");
});

test("recovers assistant mode and preserves incomplete paginated entities", () => {
  expect(source).toContain("setAssistantSearchSource(message)");
  expect(source).toContain("recoverAssistantSearchMode(assistantSearchSource)");
  expect(source).toContain("replayOverviewWindow(collectionKey, images.length, generation)");
  expect(source).toContain("reconcilePaginatedSelected(current, refreshedImages, imagesComplete)");
});

test("silently refreshes picker searches without history or selection loss", () => {
  const silentStart = source.indexOf("async function refreshIdentityPickerSearchSilently");
  const silentEnd = source.indexOf("function returnToIdentityPicker", silentStart);
  const silentRefresh = source.slice(silentStart, silentEnd);
  expect(silentRefresh).toContain("recordHistory: false");
  expect(silentRefresh).toContain("reconcilePaginatedSelected(selected, result.images, false)");
  expect(silentRefresh).not.toContain("identityPickerHistoryTimer");
  expect(source).toContain("await refreshIdentityPickerSearchSilently(identityPickerQuery, pickerCollection, generation)");
});

test("coalesces and generation-checks sharing refreshes and uses one incoming key", () => {
  expect(sharingSource).toContain("refreshInFlight.current");
  expect(sharingSource).toContain("request !== requestGeneration.current");
  expect(sharingSource).toContain("scheduleSharingRefresh()");
  expect(sharingSource).toContain("galleryQueryKeys.incomingInvites(context)");
  expect(sharingSource).not.toContain('setCachedGalleryInvites(queryClient, context, "incoming"');
  expect(sharingSource).toContain('if (view === "invites" || view === "inviteConfirm"');
});

test("generation-guards native selection, capture, upload, and polling paths", () => {
  expect(source).toContain("cameraContextGeneration.current = refreshContextGeneration.current");
  expect(source).toContain("const generation = cameraContextGeneration.current");
  expect(source).toContain("if (!isCurrent()) { deletePreparedFiles(files); return; }");
  expect(source).toContain("await wait(3_000);\n        if (!isCurrent())");
  expect(source).toContain("await prepareAssets(result.assets, generation)");
  expect(source).toContain("completeUpload(files, targetCollection.key, batchKey, generation)");
  expect(source).toContain("setPendingFiles((current) => { deletePreparedFiles(current); return []; })");
  expect(captureSource).toContain("if (!active.current) { deleteCapturedFile(normalized.uri); return; }");
});

test("closes upload surfaces on contributor loss and rechecks destinations", () => {
  expect(source).toContain("canAddImages = Boolean(activeCollection?.access?.canContribute");
  expect(source).toContain('!targetCollection?.access?.canContribute || targetCollection.role === "viewer"');
  expect(source).toContain('!currentCollection?.access?.canContribute || currentCollection.role === "viewer"');
  expect(source).toContain("setCameraOpen(false)");
});

test("replays media and picker windows and recovers contextual failures", () => {
  expect(source).toContain("replayPaginatedWindow({");
  expect(source).toContain("replayOverviewWindow(pickerCollection.key, identityPickerImages.length, generation)");
  expect(source).toContain('recoverContextualSearchFailure("similar")');
  expect(source).toContain('recoverContextualSearchFailure("identity")');
  expect(source).toContain("await replayOverviewWindow(activeCollection?.key, images.length, generation)");
});

test("orders owner sharing routes and reuses the share-link loader", () => {
  const accessStart = sharingSource.indexOf('view === "access"');
  const accessEnd = sharingSource.indexOf('view === "members"', accessStart);
  const accessMenu = sharingSource.slice(accessStart, accessEnd);
  expect(accessMenu.indexOf(">Members</BottomSheetItem>")).toBeLessThan(accessMenu.indexOf(">Share links</BottomSheetItem>"));
  expect(accessMenu.indexOf(">Share links</BottomSheetItem>")).toBeLessThan(accessMenu.indexOf(">Pending invites</BottomSheetItem>"));
  expect(accessMenu).toContain("{owner ? <>");
  expect(sharingSource).toContain('view === "members" && owner ?');
  expect(sharingSource.match(/onPress=\{\(\) => void loadLinks\(\)\}/g)?.length).toBeGreaterThanOrEqual(2);
});

test("filters share links with shared active and inactive tabs", () => {
  expect(sharingSource).toContain('accessibilityLabel="Share link status"');
  expect(sharingSource).toContain('accessibilityRole="tablist"');
  expect(sharingSource).toContain('size="xs" style={styles.tab} variant={linkTab === "active" ? "secondary" : "ghost"}');
  expect(sharingSource).toContain(">Active links</Button>");
  expect(sharingSource).toContain(">Inactive links</Button>");
  expect(sharingSource).toContain('filterGalleryShareLinks(links, linkTab === "active")');
  expect(sharingSource).toContain('Array.from({ length: 3 }');
  expect(sharingSource).toContain("No {linkTab} share links.");
  expect(sharingSource).toContain('setLinkTab(result.link.active ? "active" : "inactive")');
});

test("uses Archive-style mutation lists for collection collaboration", () => {
  expect(sharingSource).toContain('mutation = view === "members" || view === "invites"');
  expect(sharingSource).toContain('dismissible={!busy}');
  expect(sharingSource).not.toContain('tall={tall}');
  expect(sharingSource).toContain('if (navigate) { setInvites([]); setView("invites"); }');
  expect(sharingSource).toContain('queryKey: incomingInvitesQueryKey, exact: true, refetchType: "none"');
  expect(sharingSource).toContain('if (navigate) { setLinks([]); setLinkTab("active"); setView("links"); }');
  expect(sharingSource).toContain('size="sm" style={styles.pillButton} variant="secondary"');
  expect(sharingSource).toContain('pillSkeleton: { width: "100%", minHeight: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 }');
  expect(sharingSource).toContain('list: { gap: 6, paddingBottom: spacing.xl }');
  expect(sharingSource).not.toContain('rowSkeleton');
  expect(sharingSource).not.toContain('variant="ghost"><View><Text numberOfLines={1} style={styles.name}>{link.url}');
});

test("shares secure links through the native OS chooser", () => {
  expect(sharingSource).toContain('Share as NativeShare');
  expect(sharingSource).toContain('await NativeShare.share({');
  expect(sharingSource).toContain('url: link.url');
  expect(sharingSource).toContain('message: `Open ${collection.name} with this secure link: ${link.url}`');
  expect(sharingSource).toContain('result.action === NativeShare.dismissedAction');
  expect(sharingSource).toContain("if (shareWasCancelled(error)) return");
  expect(sharingSource).toContain('variant="primary">Share</Button>');
  expect(sharingSource).not.toContain('variant="primary">Copy</Button>');
  expect(sharingSource).toContain('if (!selectedLink || !owner) return');
  expect(sharingSource).toContain('view === "links" || view === "link" || view === "createLink"');
});

test("generation-guards all Gallery mutation results and rollback paths", () => {
  expect(source).toContain("const captureGalleryContextGuard = () =>");
  expect(source).toContain("const { isCurrent } = captureGalleryContextGuard()");
  expect(source).toContain('if (!isCurrent()) throw new Error("Gallery context changed.")');
  expect(source).toContain("if (!isCurrent() || request !== viewRequest.current) return");
  expect(source).toContain("invalidateAssistantChanges(queryClient, contentContext, assistantResult.changes)");
  expect(source).not.toContain("invalidateAssistantChanges(queryClient, getContentContext()");
  expect(source).toContain("setBusy(false);\n    setAssistantBusy(false)");
});

test("promotes late authoritative uploads and honors replay end proof", () => {
  expect(source).toContain("promoteAuthoritativeUploads(fetchedOverview.images)");
  expect(source).toContain("reconcileOptimisticUploads(current, authoritativeImages).remaining");
  expect(source).toContain("imagesComplete = fetchedOverview.replayReachedEnd === true");
  expect(source).toContain("pickerOverview.replayReachedEnd === true");
  expect(source).toContain('notify("Some images could not be uploaded")');
  expect(source).toContain("unresolvedUploadJobs.current.set(job.key");
  expect(source).toContain('if (plan.has("upload")) await refreshUnresolvedUploadJobs(generation)');
  expect(source).toContain("reconcileUploadJobRegistry([...unresolvedUploadJobs.current.values()], statuses)");
  expect(source).toContain("unresolvedUploadJobs.current.clear()");
  expect(source).toContain("imagesComplete = contextualReplayReachedEnd");
  expect(source).toContain("imagesComplete = normalOverview.replayReachedEnd === true");
});

test("owner pending invites remain recipient-filtered incoming actions", () => {
  expect(sharingSource).toContain("galleryQueryKeys.incomingInvites(context)");
  expect(sharingSource).toContain("listGalleryCollectionInvites(memberKeys)");
  expect(sharingSource).not.toContain("listGalleryCollectionInvites([collection.memberKey])");
  expect(sharingSource).toContain('setInviteResponse("accept")');
  expect(sharingSource).toContain('setInviteResponse("reject")');
  expect(sharingSource).not.toContain("outgoing");
});
