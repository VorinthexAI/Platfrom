import { expect, test } from "bun:test";

const normalizeSource = (value: string) =>
  value
    .replace(/\s*\n\s*\./g, ".")
    .replace(/\s+/g, " ")
    .replace(/=\{\s+/g, "={")
    .replace(/\?\s+\(\s*(?=<)/g, "? ")
    .replace(/(\/>|<\/[A-Za-z]+>) \) : \((?=\s*<)/g, "$1 :")
    .replace(/(<\/[A-Za-z]+>) \)(?= :)/g, "$1")
    .replace(/>\s+([A-Za-z][A-Za-z ]*?)\s+</g, ">$1<")
    .trim();

function expectSourceContains(value: string, expected: string) {
  expect(value).toContain(normalizeSource(expected));
}

function sourceSection(value: string, startMarker: string, endMarker: string) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return value.slice(start, end);
}

function expectBefore(value: string, first: string, second: string) {
  const firstIndex = value.indexOf(first);
  const secondIndex = value.indexOf(second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

const source = normalizeSource(await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text());
const galleryClientSource = normalizeSource(await Bun.file(new URL("gallery-client.ts", import.meta.url)).text());
const captureSource = await Bun.file(new URL("../components/capability/GalleryCaptureModal.tsx", import.meta.url)).text();
const cameraSource = await Bun.file(new URL("../components/capability/BrandedCameraModal.tsx", import.meta.url)).text();
const bottomSheetSource = await Bun.file(new URL("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx", import.meta.url)).text();

test("opens collection-scoped image similarity in an invalidated full-screen sheet", () => {
  const footer = source.slice(source.indexOf('const sheetFooter ='), source.indexOf('return (', source.indexOf('const sheetFooter =')));
  expect(footer).not.toContain("Find similar");
  expect(source).toContain("imageKey: source.key, collectionKey: collection.key");
  expect(source).toContain("Image.prefetch(url)");
  expect(source).toContain('galleryQueryKeys.search(galleryContext, "similar", collection.key, source.key)');
  expect(source).toContain('invalidateQueries({ queryKey, exact: true, refetchType: "none" })');
  expect(source).toContain('activeSheetRef.current === "similar"');
  expect(source).toContain('openSheet("similar")');
  expect(source).toContain('height={activeSheet === "destination" || activeSheet === "imageEdit" || activeSheet === "newCollection" || activeSheet === "collectionEdit" || activeSheet === "similar"');
  expect(source).toContain('activeSheet === "similar" ? "Similar images"');
  expect(source.indexOf(">Find similar<")).toBeLessThan(source.indexOf(">Delete image<"));
});

test("uses four-column cursor grids and one skeleton row for initial and append loading", () => {
  expect(source).toContain("const IMAGE_COLUMNS = 4");
  expect(source).toContain("fetchGalleryOverview(collectionKey, cursor, 100)");
  expect(source).toContain("Array.from({ length: IMAGE_COLUMNS }");
  expect(source).toContain('loadingMore ? <View style={styles.grid}>');
  expect(source).toContain('key={`more-${index}`}');
});

test("groups collection images by created date", () => {
  expect(source).toContain("groupGalleryImagesByCreatedDate<GalleryGridItem>");
  expect(source).toContain("createdAt: item.createdAt");
  expect(source).toContain('entry.kind === "optimistic"');
  expect(source).toContain("visibleImageGroups.map((group)");
  expect(source).toContain("styles.dateHeading");
});

test("uses one origin-neutral collection image stream", () => {
  expect(source).not.toContain('accessibilityLabel="Image origin"');
  expect(source).not.toContain('>Uploaded</Button>');
  expect(source).not.toContain('>Generated</Button>');
  expect(source).not.toContain("imageOrigin");
  expect(source).toContain("galleryQueryKeys.overview(galleryContext, collectionKey)");
  expect(source).toContain("fetchGalleryOverview(collectionKey, cursor, 100)");
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

test("treats user-policy generated media as a normal owner collection menu", () => {
  const managedPolicy = sourceSection(galleryClientSource, "export function isManagedGalleryCollection", "export function isManagedGalleryImage");
  const collectionMenu = sourceSection(source, '{activeSheet === "collectionMenu" ? <BottomSheetMenu', '{activeSheet === "cleanupMenu"');
  expect(managedPolicy).toContain('collection?.purpose === "place-media" || collection?.mutationPolicy === "system-only"');
  expect(managedPolicy).not.toContain('purpose === "generated-media"');
  expect(collectionMenu).toContain("isCollectionOwner && !managedCollection");
  for (const action of ["Edit", "Visual identities", '"Reveal" : "Hide"', "Delete collection"]) expect(collectionMenu).toContain(action);
});

test("keeps delete confirmations idle while optimistic deletion runs", () => {
  for (const [sheet, nextSheet] of [
    ["confirmDeleteImage", "confirmDeleteCollection"],
    ["confirmDeleteCollection", "duplicates"],
    ["bulkDelete", "transferDestination"],
  ] as const) {
    const confirmation = sourceSection(source, `{activeSheet === "${sheet}" ? <View`, `{activeSheet === "${nextSheet}"`);
    expect(confirmation).toContain('variant="primary">Delete</Button>');
    expect(confirmation).not.toContain("loading={busy}");
  }
});

test("closes and filters optimistically before image and collection delete requests", () => {
  const imageDelete = sourceSection(source, "function deleteSelectedImage", "async function showDuplicates");
  expectBefore(imageDelete, "setImages((current) => current.filter", "deleteGalleryImages([target.key])");
  expectBefore(imageDelete, "closeSheet()", "deleteGalleryImages([target.key])");

  const collectionDelete = sourceSection(source, "async function removeActiveCollection", "function replaceVisibleImages");
  expectBefore(collectionDelete, "closeSheet()", "deleteGalleryCollection(collection.key)");
  expectBefore(collectionDelete, "updateCollectionSingleton((current) => current.filter", "deleteGalleryCollection(collection.key)");

  const bulkDelete = sourceSection(source, "function deleteSelectedImages", "function completeTransfer");
  expectBefore(bulkDelete, "setImages((current) => current.filter", "deleteGalleryImages(keys)");
  expectBefore(bulkDelete, "setSelectedImageKeys([])", "deleteGalleryImages(keys)");
  expectBefore(bulkDelete, "closeSheet()", "deleteGalleryImages(keys)");
});

test("uses canonical root collection search and filtering with the singleton cache", () => {
  expect(source).toContain("getGalleryCollections(queryClient");
  expect(source).toContain("setCachedGalleryCollections");
  expect(source).toContain('searchGalleryCollections(normalized, false, controller.signal, selectedTagKeys)');
  expect(source).toContain('accessibilityLabel="Search Gallery collections"');
  expect(source).toContain('accessibilityLabel="Filter Gallery"');
  expect(source).toContain('accessibilityLabel="Create in Gallery"');
});

test("keeps empty Gallery views scrollable for pull-to-refresh", () => {
  expect(source).toContain('refreshControl={<PullToRefresh onRefresh={refreshGallery} refreshing={userRefreshing} />}');
  expect(source).not.toContain("const galleryEmpty = !loading && (");
  expect(source).not.toContain("scrollEnabled={!galleryEmpty}");
});

test("fences pull-to-refresh results to the initiating Gallery view", () => {
  const refresh = source.slice(source.indexOf("async function refreshGallery"), source.indexOf("const activeSubjects", source.indexOf("async function refreshGallery")));
  expect(source).toContain("const currentRefreshViewKey = JSON.stringify([activeCollection?.key, currentGalleryView, query.trim(), rootSearchQuery.trim(), selectedTagKeys, activeSubject?.key, activeIdentityFilter?.key])");
  expect(source).toContain("refreshViewKey.current = currentRefreshViewKey");
  expect(source).toContain("isCurrentContextGeneration(generation, refreshContextGeneration.current) && isViewCurrent()");
  expect(refresh).toContain("const viewKey = refreshViewKey.current");
  expect(refresh).toContain("const viewGeneration = viewRequest.current");
  expect(refresh).toContain("const searchGeneration = searchRequest.current");
  expect(refresh).toContain("refreshViewKey.current === viewKey && viewRequest.current === viewGeneration && searchRequest.current === searchGeneration");
});

test("uses direct plus actions and one unified collection empty state", () => {
  expect(source).toContain('!rootSearchActive && canCreateCollections');
  expect(source).toContain('accessibilityLabel="Create collection"');
  expect(source).toContain('accessibilityLabel={`Upload images to ${activeCollection.name}`}');
  expect(source).toContain('activeCollection ? "No images yet."');
  expect(source).not.toContain("No uploaded images yet.");
  expect(source).not.toContain("No generated images yet.");
});

test("keeps Gallery favorites, hidden items, and search history in the root filter sheet", () => {
  const start = source.indexOf('activeSheet === "filter" ?');
  const filterSheet = source.slice(start, source.indexOf('activeSheet === "identityPickerFilter"', start));
  expect(filterSheet).toContain('>Favorites</Text>');
  expect(filterSheet).toContain('>Show hidden</Text>');
  expect(filterSheet).not.toContain('>Visual identities</Button>');
  expect(filterSheet).toContain('>Search history</Button>');
});

test("integrates session tag filters into primary Gallery collection and image views", () => {
  expect(source).toContain("const tagContextKey = tagFilterContextKey(contentContext)");
  expect(source).toContain("state.selectedTagsByContext[tagContextKey] ?? EMPTY_SELECTED_TAGS");
  expect(source.match(/<TagFilterLane context=\{contentContext\} \/>/g)).toHaveLength(2);
  expect(source).toContain('<TagFilterSheet context={contentContext} onClose={() => setTagFilterOpen(false)} open={tagFilterOpen} />');
  expect(source).toContain("searchGalleryCollections(normalized, false, controller.signal, selectedTagKeys)");
  expect(source).toContain("collectionKey: collection.key");
  expect(source).toContain("tagKeys: selectedTagKeys");
  expect(source).toContain(">Tags</BottomSheetItem>");
  const transferStart = source.lastIndexOf('activeSheet === "transferDestination"');
  expect(transferStart).toBeGreaterThanOrEqual(0);
  const transferDestinations = source.slice(transferStart);
  expect(transferDestinations).not.toContain("selectedTagKeys");
  expect(transferDestinations).not.toContain("TagFilterLane");
});

test("opens resource tags for selected main images without adding tags to cleanup or picker flows", () => {
  expect(source).toContain('<ResourceTagsSheet context={contentContext} onClose={() => setResourceTagsOpen(false)} open={resourceTagsOpen} targets={resourceTagTargets} />');
  expect(source).toContain('const resourceTagTargets = selectedImageKeys.map((key) => ({ type: "image" as const, key }))');
  const bulkActions = sourceSection(source, '{activeSheet === "bulkActions" ? <BottomSheetMenu>', '{activeSheet === "bulkDelete" ? <View');
  expect(bulkActions).toContain('onPress={openResourceTags}');
  expect(bulkActions).toContain('>Tags</Button>');
  const duplicates = sourceSection(source, 'activeSheet === "duplicates"', 'activeSheet === "cleanupMenu"');
  expect(duplicates).not.toContain('openResourceTags');
  const picker = sourceSection(source, 'activeSheet === "identityPicker"', 'activeSheet === "identityName"');
  expect(picker).not.toContain('openResourceTags');
  expect(sourceSection(source, 'function openResourceTags()', 'function pushSheet')).not.toContain('setSelectedImageKeys([])');
});

test("presents managed media with its persisted app identity and creator-owned Core image actions", () => {
  expect(source).toContain("isManagedGalleryCollection(activeCollection)");
  expect(source).toContain("contentPresentationIconSource[collection.presentation]");
  expect(source).toContain('`${collection.name} app collection`');
  expect(source).toContain("style={styles.managedCollectionLogo}");
  expect(source).toContain('collection?.purpose === "generated-media"');
  expect(source).toContain('image.createdByKey === collection.actorKey');
  expect(source).toContain('source={assistantIconSource}');
  expect(source).toContain("activeCollection && !managedCollection ? <GalleryHighlights");
  expect(source).toContain("activeCollection && !managedCollection ? <GalleryMemories");
  expect(source).toContain("!managedCollection ? <View style={styles.intelligenceRow}");
  const collectionMenuStart = source.indexOf('{activeSheet === "collectionMenu" ? <BottomSheetMenu>');
  const collectionMenu = source.slice(collectionMenuStart, source.indexOf('activeSheet === "cleanupMenu"', collectionMenuStart));
  expect(collectionMenu).toContain('!managedCollection');
  expect(collectionMenu).toContain('setHiddenOptimistically("collection"');
  expect(collectionMenu).not.toContain("Select images");
  expect(collectionMenu).not.toContain("Find duplicates");
  const imageMenuStart = source.indexOf('activeSheet === "imageActions" && selectedImage');
  const imageMenu = source.slice(imageMenuStart, source.indexOf('activeSheet === "imageEdit"', imageMenuStart));
  expect(imageMenu).toContain("Find similar");
  expect(imageMenu).toContain("canMutateImage(selectedImage)");
  for (const action of ["Edit", "Find similar", "Hide", "Delete image"]) expect(imageMenu).toContain(action);
  expect(source).toContain("selectedImage && (activeCollection || !isManagedGalleryImage(selectedImage))");
});

test("leaves Core keyboard movement to its composer and uses distinct image sheet presentations", () => {
  expect(source).not.toContain("KeyboardAvoidingView");
  expect(source).toContain('hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions" || activeSheet === "cleanupMenu"}');
  expect(source).toContain('open={sheetOpen && (activeSheet === "image" || activeSheet === "imageActions") && Boolean(selectedImage || selectedOptimisticItem)}');
  expectSourceContains(source, 'height="full"\n        onOpenChange');
  expect(source).toContain('height={activeSheet === "destination" || activeSheet === "imageEdit"');
  expect(source).not.toContain('activeSheet === "imageActions" || activeSheet === "imageEdit"');
  expect(source).not.toContain("detailCaption");
  expect(source).toContain('accessibilityLabel="Open image actions"');
  expect(source).toContain('style={styles.detailMenuButton} variant="icon"');
  expect(source).toContain('detailMenuButton: { width: 34, height: 34, minHeight: 34 }');
  expect(source).toContain('selectedImage && imageViewerSize.width > 0 && imageViewerSize.height > 0 ? <GalleryViewerImage');
  expect(source).toContain('<Button onPress={similarBehindImage ? goBackSheet : closeSheet} size="md" variant="secondary">Close</Button>');
  expect(source).toContain('if (activeSheetRef.current === "imageActions") goBackSheet(); else closeSheet();');
  expect(source).toContain('mergeMediaItems([], unfilteredVisibleImages).filter');
  expect(source).toContain('detailImageFrame: { flex: 1, width: "100%", overflow: "hidden", alignItems: "center", justifyContent: "center" }');
  expect(bottomSheetSource).toContain('height?: "full"');
  expect(bottomSheetSource).not.toContain("mutation?: boolean");
  expect(bottomSheetSource).not.toContain("tall?: boolean");
  expect(bottomSheetSource).toContain('fullSheet: {\n    bottom: 0');
  expect(bottomSheetSource).toContain('Platform.OS === "android" ? insets.bottom : 0');
  expect(bottomSheetSource).toContain('bottom: fullHeight ? sheetBottom');
  expect(bottomSheetSource).toContain('borderBottomLeftRadius: 24');
  expect(bottomSheetSource).toContain('borderBottomRightRadius: 24');
  expect(bottomSheetSource).not.toContain('height: fullHeight ? windowHeight - insets.top - androidBottomInset');
});

test("uses the rounded whole-sheet swipe pager for opened collection images", () => {
  expect(source).toContain('onSwipeLeft={collectionViewerImages.length > 1 ? () => focusCollectionImage(1) : undefined}');
  expect(source).toContain('onSwipeRight={collectionViewerImages.length > 1 ? () => focusCollectionImage(-1) : undefined}');
  expect(source).toContain('pageKey={selectedImage?.key ?? selectedOptimisticItem?.clientKey}');
  expect(source).not.toContain("imageViewerRef");
  expect(source).toContain("fitContainedMediaSize(image, viewport)");
  expect(source).toContain("detailImage: { borderRadius: radii.lg }");
  expect(source).toContain('alignItems: "center", justifyContent: "center"');
});

test("keeps new collection creation to a required name", () => {
  const start = source.indexOf('{activeSheet === "newCollection" ? <View');
  const form = source.slice(start, source.indexOf('activeSheet === "collectionMenu"', start));
  expect(form).toContain('accessibilityLabel="Collection name"');
  expect(form).toContain('placeholder="Name"');
  expect(form).not.toContain('Favorite collection');
  expect(source).not.toContain('newCollectionFavorite');
  expect(source).toContain('createGalleryCollection(name, false)');
  expect(source).not.toContain('accessibilityLabel="Collection description"');
});

test("provides the full visual identity library and image picker workflow", () => {
  const rootActionsStart = source.indexOf('{activeSheet === "rootActions" ? <BottomSheetMenu>');
  const rootActions = source.slice(rootActionsStart, source.indexOf('activeSheet === "actions"', rootActionsStart));
  const collectionActionsStart = source.indexOf('{activeSheet === "actions" ? <BottomSheetMenu>');
  const collectionActions = source.slice(collectionActionsStart, source.indexOf('activeSheet === "destination"', collectionActionsStart));
  expect(rootActions).toContain('onPress={() => void openIdentityPicker()}');
  expect(rootActions).not.toContain('openVisualIdentities()');
  expect(collectionActions).toContain('onPress={() => void openIdentityPicker()}');
  expect(collectionActions).not.toContain('openVisualIdentities()');
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
  expect(source).toContain('<Button disabled={identitiesLoading} onPress={() => void openIdentityPicker()} size="md" variant="primary">Create</Button>');
  expect(source).not.toContain('identityLibraryMode === "browse" ? <Button');
  expect(source.match(/onPress=\{\(\) => void openVisualIdentities\(\)\} size="md" variant="secondary">Visual identities<\/Button>/g)).toHaveLength(1);
});

test("keeps similar-image results sheet-local without replacing the collection grid", () => {
  const similar = source.slice(source.indexOf("async function findSimilar"), source.indexOf("function showSimilarImage"));
  const collectionDelete = source.slice(source.indexOf("async function removeActiveCollection"), source.indexOf("function replaceVisibleImages"));
  expect(similar).not.toContain("setActiveIdentityFilter(undefined)");
  expect(source).toContain("const unfilteredVisibleImages = activeIdentityFilter && activeCollection");
  expect(source).not.toContain("const unfilteredVisibleImages = similarSource");
  expect(source).not.toContain("Similar to ${similarSource.filename}");
  expect(source).not.toContain('accessibilityLabel="Close similar image filter"');
  expect(collectionDelete).toContain("setActiveIdentityFilter(undefined)");
  expect(collectionDelete).toContain("setSimilarSource(undefined)");
  expect(source).toContain('accessibilityLabel="Close visual identity filter"');
});

test("renders one four-card skeleton row and guarded results in the similar-images sheet", () => {
  const sheet = sourceSection(source, 'activeSheet === "similar" || similarBehindImage ? <FlatList', ': <ScrollView');
  expect(sheet).toContain('style={styles.fullSheetScroll}');
  expect(sheet).toContain('contentContainerStyle={styles.similarListContent}');
  expect(sheet).toContain('accessibilityLabel="Loading similar images"');
  expect(sheet).toContain('Array.from({ length: IMAGE_COLUMNS }');
  expect(sheet).toContain('width: sheetImageSize, height: sheetImageSize');
  expect(sheet).toContain('data={similarLoading ? [] : similarImages}');
  expect(sheet).toContain('onPress={() => showSimilarImage(image)}');
  expect(sheet).toContain('shape="rounded"');
  expect(sheet).toContain('No similar images found in this collection.');
  expect(source).toContain('const matches = result.images.filter(({ key }) => key !== source.key)');
  const openResult = source.slice(source.indexOf("function showSimilarImage"), source.indexOf("function openImageEdit"));
  expect(openResult).toContain('pushSheet("image")');
  expect(openResult).not.toContain("setSimilarImages([])");
  expect(source).toContain('setSimilarBehindImage(sheet === "image" && (current === "similar" || sheetStack.current.includes("similar")))');
  expect(source).toContain('(activeSheet !== "image" || similarBehindImage)');
});

test("uses separate image-selection and naming steps for visual identities", () => {
  expect(source).toContain('activeSheet === "identityName"');
  expect(source).toContain('imagePickerPurpose === "cover" ? chooseCollectionCover() : pushSheet("identityName")');
  expect(source).toContain('placeholder="Name"');
  expect(source).not.toContain("Name, for example Hugo");
  expect(source).toContain('accessibilityLabel="Choose a different visual identity image"');
  expect(source).toContain("returnToIdentityLibrary();");
  expect(source).toContain("width: 88, height: 88");
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll');
  expect(source.indexOf('accessibilityLabel="Back to collections"')).toBeLessThan(source.indexOf('accessibilityLabel="Search images for visual identity"'));
});

test("supports direct empty-state upload and twelve removable camera captures", () => {
  expect(source).toContain('accessibilityLabel={`Upload images to ${activeCollection.name}`}');
  expect(source).toContain("<GalleryCaptureModal");
  expect(source).toContain('refetchType: "none"');
  expect(captureSource).toContain("MAX_GALLERY_CAPTURES = 12");
  expect(captureSource).toContain("normalizeCapturedPng");
  expect(captureSource).toContain('filename: `gallery-${timestamp}.png`');
  expect(source).toContain('filename: `gallery-${currentTimestamp()}-${index + 1}.png`');
  expect(source).toContain('mimeType: "image/png"');
  expect(captureSource).toContain("normalized.latitude");
  expect(captureSource).toContain("Remove image");
  expect(cameraSource).toContain("exif: true");
  expect(cameraSource).toContain('setFacing((current) => current === "back" ? "front" : "back")');
  expect(cameraSource).toContain('shutter: { height: 74');
  expect(cameraSource).toContain('width: 74');
  expect(captureSource).toContain('hint=""');
  expect(source).toContain("showOptimisticImage(entry.item)");
  expect(source).toContain("Image.prefetch(image.url)");
  expect(source).toContain("!optimisticImageKeys.has(key)");
  expect(source).toContain("key: item.imageKey ?? item.clientKey");
  expect(source).toContain("current?.key === selected.clientKey && updated.imageKey");
  expect(source).not.toContain('accessibilityLabel="Processing image"');
  expect(source).not.toContain('`${matches.length} image${matches.length === 1 ? "" : "s"}${collection ? ` in ${collection.name}` : ""}.`');
});

test("selects returned duplicates for deletion and lets each image be preserved", () => {
  expect(source).toContain('setDuplicateSelectedImageKeys(result.images.map(({ key }) => key))');
  expect(source).toContain('accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename} for duplicate deletion`}');
  expect(source).toContain('toggleDeletionSelection(image.key, setDuplicateSelectedImageKeys)');
  expect(source).toContain('const targets = duplicateImages.filter(({ key }) => selectedKeys.has(key))');
  expect(source).toContain('const remainingDuplicates = duplicateImages.filter(({ key }) => !removedKeys.has(key))');
  expect(source).toContain('pushSheet("confirmDeleteIdentity")');
  expect(source).toContain("deleteGallerySubject(identity.key)");
  expect(source.indexOf("setSubjects((current) => current.filter")).toBeLessThan(source.indexOf("deleteGallerySubject(identity.key)"));
});

test("uses standard right-side close controls and hides collection menu headings", () => {
  const preview = sourceSection(source, "<BottomSheet footer=", "{selectedImage || selectedOptimisticItem");
  const sheet = sourceSection(source, "<BottomSheet description=", '{activeSheet === "cleanup"');
  expect(preview).toContain('title={selectedImage?.filename ?? selectedOptimisticItem?.filename ?? "Image"}');
  expect(sheet).toContain('title={similarBehindImage ? "Similar images" : sheetTitle}');
  expect(`${preview}${sheet}`).not.toContain("headerLeading");
  expect(`${preview}${sheet}`).not.toContain("headerTrailing");
  expect(`${preview}${sheet}`).not.toContain("hideCloseButton");
  expect(sheet).toContain('hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions" || activeSheet === "cleanupMenu"}');
});

test("provides collection cleanup discovery, pagination, selection, and confirmed canonical deletion", () => {
  const cleanupIcon = source.indexOf('<BrainIcon size="sm"');
  expect(cleanupIcon).toBeGreaterThan(-1);
  expect(source).toContain('<Button accessibilityLabel={`AI actions for ${activeCollection.name}`}');
  expect(source).toContain('{isCollectionOwner ? <BottomSheetItem onPress={() => void showCleanup()}');
  expect(source).toContain('activeSheet === "cleanupMenu" ? <BottomSheetMenu>');
  const intelligenceMenuStart = source.indexOf('{activeSheet === "cleanupMenu" ? <BottomSheetMenu>');
  const intelligenceMenu = source.slice(intelligenceMenuStart, source.indexOf('activeSheet === "imageActions"', intelligenceMenuStart));
  expect(intelligenceMenu.indexOf('>Find duplicates</BottomSheetItem>')).toBeLessThan(intelligenceMenu.indexOf('>Clean up</BottomSheetItem>'));
  expect(source).toContain('>Clean up</BottomSheetItem>');
  expect(source).toContain('activeSheet === "cleanup" ? "Clean up"');
  expect(source).toContain('Choose a quality threshold to find and remove lower-quality images. Images are scored from 1 to 100.');
  expect(source).toContain('const CLEANUP_THRESHOLDS = [10, 25, 50, 75, 90] as const');
  expect(source).toContain('fetchGalleryOverview(collection.key, cursor, 100, threshold)');
  expect(source).toContain('appendCursorItems(cached?.images ?? [], result.images');
  expect(source).toContain('setCleanupSelectedImageKeys(result.images.map(({ key }) => key))');
  expect(source).toContain('accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename} for cleanup`}');
  expect(source).toContain('toggleDeletionSelection(image.key, setCleanupSelectedImageKeys)');
  expect(source).toContain('const targets = cleanupImages.filter(({ key }) => selectedKeys.has(key))');
  expect(source).toContain('for (let index = 0; index < targets.length; index += DELETE_IMAGE_CHUNK_SIZE)');
  expect(source).toContain('await deleteGalleryImages(eligibleChunk.map(({ key }) => key))');
  expect(source).toContain('activeSheet === "confirmCleanupDelete" ? `Delete ${cleanupSelectedCount === 1 ? "image" : `${cleanupSelectedCount} images`}?`');
  expect(source).toContain('activeSheet === "duplicates" || activeSheet === "cleanup"');
  expect(source).toContain('!collection || cleanupCollectionKeyRef.current !== collection.key');
  expect(source).not.toContain('cleanupScore');
});

test("guards favorite collection and image deletion before optimistic state changes", () => {
  const collectionDelete = source.slice(source.indexOf("async function removeActiveCollection"), source.indexOf("function replaceVisibleImages"));
  expect(collectionDelete.indexOf("if (latest.isFavorite)")).toBeLessThan(collectionDelete.indexOf("setBusy(true)"));
  expect(collectionDelete).toContain('notify("Can\'t delete favorite collection")');
  expect(collectionDelete).toContain('isGalleryClientErrorCode(error, "GALLERY_COLLECTION_FAVORITE")');
  expect(collectionDelete).toContain('setStatus(favoriteConflict ? undefined : "Collection deletion failed.")');

  const imageDelete = source.slice(source.indexOf("function deleteSelectedImage"), source.indexOf("async function showDuplicates"));
  expect(imageDelete.indexOf("if (target.isFavorite)")).toBeLessThan(imageDelete.indexOf("snapshotGalleryOverviews"));
  expect(imageDelete).toContain('notify("Can\'t delete favorite image")');
  expect(imageDelete).toContain("reconcileGalleryImageDeletion([target], result)");
  expect(imageDelete).toContain("busyRef.current = true");
  expect(imageDelete).toContain("busyRef.current = false");
  expect(imageDelete).toContain("activeCollectionKey.current !== previousActiveCollection?.key || viewRequest.current !== previousViewRequest || searchRequest.current !== previousSearchRequest");
  expect(imageDelete).toContain("if (reconciled.deletedImages.length !== 1)");
  expect(imageDelete).toContain("restore();");
});

test("partitions and result-reconciles normal bulk and duplicate deletion", () => {
  const duplicates = source.slice(source.indexOf("async function deleteDuplicates"), source.indexOf("const isCurrentCleanupRequest"));
  expect(duplicates).toContain("partitionFavoriteGalleryImages(targets)");
  expect(duplicates).toContain("eligibleImages.length === 0");
  expect(duplicates).toContain("eligibleImages.map(({ key }) => key)");
  expect(duplicates).toContain("reconcileGalleryDuplicateDeletion(eligibleImages, deleted)");
  expect(duplicates).toContain("applyAuthoritativeFavoriteImages(reconciled.favoriteImages)");
  expect(duplicates).toContain("setDuplicateImages(remainingDuplicates)");
  expect(duplicates).toContain("queryClient.setQueryData(queryKey, { images: remainingDuplicates })");
  expect(duplicates).toContain('invalidateQueries({ queryKey, exact: true, refetchType: "none" })');
  expectSourceContains(duplicates, 'reconciled.unknownImages.length\n        ? "Some images were not deleted."');
  expectSourceContains(duplicates, 'notify(reconciled.unknownImages.length\n        ? "Some images were not deleted"');
  expect(duplicates).toContain('notify("Duplicate deletion failed")');
  expect(duplicates).not.toContain("if (localFavorites.length) goBackSheet()");

  const bulk = source.slice(source.indexOf("function deleteSelectedImages"), source.indexOf("function completeTransfer"));
  expect(bulk).toContain("partitionFavoriteGalleryImages(targets)");
  expect(bulk).toContain("eligibleImages.length === 0");
  expect(bulk).toContain("reconcileGalleryImageDeletion(eligibleImages, result)");
  expect(bulk).toContain("setImages((current) => current.filter(({ key }) => !keys.includes(key)))");
  expect(bulk).toContain("const favoriteCount = localFavorites.length + reconciled.favoriteImages.length");
  expect(bulk).toContain('if (reconciled.unknownImages.length) setStatus("Some images were not deleted.")');
  expectSourceContains(bulk, 'notify(reconciled.unknownImages.length\n        ? "Some images were not deleted"');
  expect(bulk).toContain('notify("Image deletion failed")');
  expect(bulk).not.toContain("if (localFavorites.length) closeSheet()");
});

test("partitions cleanup per authoritative chunk and preserves protected cards", () => {
  const cleanup = source.slice(source.indexOf("async function deleteCleanupImages"), source.indexOf("async function openVisualIdentities"));
  expect(cleanup).toContain("partitionFavoriteGalleryImages(targets)");
  expect(cleanup).toContain("eligibleImages.length === 0");
  expect(cleanup).toContain("targets.slice(index, index + DELETE_IMAGE_CHUNK_SIZE)");
  expect(cleanup).toContain("partitionFavoriteGalleryImages(chunk)");
  expect(cleanup).toContain("reconcileGalleryImageDeletion(eligibleChunk, result)");
  expect(cleanup).toContain("applyAuthoritativeFavoriteImages(reconciled.favoriteImages)");
  expect(cleanup).toContain("for (const { key } of reconciled.favoriteImages) serverFavoriteKeys.add(key)");
  expect(cleanup).toContain("for (const { key } of reconciled.unknownImages) unknownKeys.add(key)");
  expect(cleanup).toContain("applyDeletedCleanupImages(deletedTargets, sourceCollectionKey)");
  expectSourceContains(cleanup, 'notify(unknownKeys.size\n        ? "Some images were not deleted"');
  expect(cleanup).toContain('if (deletedTargets.length && activeSheetRef.current === "confirmCleanupDelete") goBackSheet()');
  expect(cleanup).toContain('notify(deletedTargets.length ? "Some images were not deleted" : "Image deletion failed")');
});

test("patches authoritative server favorites across Gallery caches and candidate lists", () => {
  const start = source.indexOf("function applyAuthoritativeFavoriteImages");
  const end = source.indexOf("function deleteSelectedImage", start);
  const patch = source.slice(start, end);
  expect(patch).toContain("favorites.forEach((image) => patchGalleryImage(queryClient, galleryContext, image))");
  expect(patch).toContain('[...galleryQueryKeys.all(galleryContext), "search"]');
  expect(patch).toContain('[...galleryQueryKeys.all(galleryContext), "duplicates"]');
  for (const setter of ["setImages", "setSimilarImages", "setCollectionSearchResults", "setCleanupImages", "setDuplicateImages", "setIdentityPickerImages", "setIdentityPickerResults", "setSelectedImage", "setIdentityPickerSelected"]) expect(patch).toContain(setter);
});

test("loads every collection page while the favorite-only filter is active", () => {
  expect(source).toContain("const loadMoreFavoriteImages = useEffectEvent(loadMoreImages)");
  expect(source).toContain("if (!showOnlyFavorites || loading)");
  expect(source).toContain("if (!activeCollection || !nextCursor || loadingMore || query.trim() || selectedTagKeys.length || activeSubject || showingSearchResults) return;");
  expect(source).toContain('const request = `${activeCollection.key}:${nextCursor}`');
  expect(source).toContain("if (favoritePageRequest.current === request) return;");
  expect(source).toContain("void loadMoreFavoriteImages();");
  expect(source).toContain("(searching || (loadingMore && showOnlyFavorites)) && visibleImages.length === 0");
});

test("reloads the guarded collection singleton after confirmed global image deletions", () => {
  const helperStart = source.indexOf("function refreshCollectionSingletonAfterImageDeletion");
  const helperEnd = source.indexOf("function updateCollectionSingleton", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  expect(helper).toContain("galleryQueryKeys.collections(galleryContext), exact: true");
  expect(helper).toContain("collectionDeletionRefresh.current.catch(() => undefined).then");
  expect(helper).toContain("collectionDeletionRefresh.current = refresh");
  expect(helper).toContain("loadCollectionSingleton(generation)");
  expect(helper).toContain("isCurrentContextGeneration(generation, refreshContextGeneration.current)");
  expect(source.match(/refreshCollectionSingletonAfterImageDeletion\(generation\)/g)?.length).toBeGreaterThanOrEqual(4);
});

test("remounts collection feature sheets with distinct keys", () => {
  expect(source).toContain('key={`highlights:${activeCollection.key}`}');
  expect(source).toContain('key={`memories:${activeCollection.key}`}');
});

test("direct image routes resolve exact keys beyond the loaded page and at Gallery root", () => {
  const directRoute = source.slice(source.indexOf("if (!initialImageKey || initialImageOpened.current"), source.indexOf("const returnToTripAssets"));
  expect(directRoute).toContain("galleryQueryKeys.image(galleryContext, initialCollectionKey, initialImageKey)");
  expect(directRoute).toContain("searchGalleryImages({ imageKey: initialImageKey, ...(initialCollectionKey ? { collectionKey: initialCollectionKey } : {}) })");
  expect(directRoute).toContain("request !== initialImageRequest.current || generation !== refreshContextGeneration.current");
  expect(directRoute).toContain("setImages((current) => appendCursorItems(current, [image], ({ key }) => key))");
  expect(directRoute).toContain("setSelectedImage(image)");
  expect(directRoute).toContain('activeSheetRef.current = "image"');
  expect(directRoute).toContain('setActiveSheet("image")');
  expect(directRoute).toContain("setSheetOpen(true)");
});

test("settles duplicate and similar loading when event refresh supersedes the opening request", () => {
  const refreshStart = source.indexOf('if (activeSheetRef.current === "duplicates"');
  const refreshEnd = source.indexOf("if (needsOverview && activeSheetRef.current", refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);
  expect(refresh).toContain('setDuplicatesError(errorMessage(error))');
  expect(refresh).toContain('setDuplicatesLoading(false)');
  expect(refresh).toContain('setSimilarError(errorMessage(error))');
  expect(refresh).toContain('setSimilarLoading(false)');
});

test("caches cleanup thresholds while keeping selection and cursors safe", () => {
  expect(source).not.toContain('cleanupExcludedKeys');
  expect(source).toContain('setCleanupSelectedImageKeys(cached.images.map(({ key }) => key))');
  expect(source).toContain('setCleanupSelectedImageKeys(result.images.map(({ key }) => key))');
  expect(source).toContain('setCleanupSelectedImageKeys((current) => [...new Set([...current, ...result.images.map(({ key }) => key)])])');
  expect(source).toContain('const cleanupCursorRef = useRef<string | null>(null)');
  expect(source).toContain('const cleanupLoadingRef = useRef(false)');
  expectSourceContains(source, 'cleanupCursorRef.current = null;\n    cleanupLoadingRef.current = true;');
  expect(source).toContain('const cursor = cleanupCursorRef.current');
  expect(source).toContain('if (!collection || !cursor || cleanupLoadingRef.current || cleanupLoadingMoreRef.current');
  expect(source).toContain('galleryQueryKeys.cleanup(galleryContext, collection.key, threshold)');
  expect(source).toContain('staleTime: Infinity');
  expect(source).toContain('queryClient.getQueryState(queryKey)?.isInvalidated !== true');
  expect(source).toContain('queryClient.getQueryData<CleanupPage>(queryKey)');
  expect(source).toContain('queryClient.setQueryData(queryKey, next)');
});

test("traverses empty cleanup pages and binds convergence to the source collection", () => {
  expect(source).toContain('const traversedCursors = new Set<string | undefined>()');
  expect(source).toContain('while (!traversedCursors.has(cursor))');
  expect(source).toContain('if (mutableImages.length > 0 || !page.nextCursor)');
  expect(source).toContain('cursor = page.nextCursor');
  expect(source).toContain('const sourceCollectionKey = cleanupCollectionKeyRef.current');
  expect(source).toContain('applyDeletedCleanupImages(deletedTargets, sourceCollectionKey)');
  expect(source).toContain('collection.key === sourceCollectionKey');
  expect(source).not.toContain('const collectionKey = activeCollectionKey.current;\n    updateCollectionSingleton');
});

test("invalidates and authoritatively reloads cleanup for external changes", () => {
  expect(source).toContain('galleryQueryKeys.cleanups(galleryContext, collectionKey), refetchType: "none"');
  expectSourceContains(source, 'await invalidation;\n    if (activeSheetRef.current === "cleanup"');
  expect(source).toContain('if (!busyRef.current && plan.has("cleanup")');
  expect(source).toContain('if (cleanupWasOpen && plan.has("cleanup")) invalidateCleanupLoad()');
  expect(source).toContain('const needsCleanup = cleanupWasOpen && plan.has("cleanup")');
  expect(source).toContain('await loadCleanupImages(cleanupThresholdRef.current, currentCollection)');
  expect(source).toContain('request === cleanupRequest.current');
  expect(source).toContain('cleanupCollectionKeyRef.current === collectionKey');
});

test("virtualizes cleanup directly and keeps later pages reachable after deselection", () => {
  expect(source).toContain('activeSheet === "cleanup" ? <FlatList');
  expect(source).toContain('numColumns={IMAGE_COLUMNS}');
  expect(source).toContain('keyExtractor={({ key }) => key}');
  expect(source).toContain('onEndReached={() => void loadMoreCleanupImages()}');
  expect(source).toContain('ListHeaderComponent={<View style={styles.cleanupHeader}>');
  expect(source).toContain('ListEmptyComponent={cleanupLoading ?');
  expect(source).toContain('ListFooterComponent={cleanupLoadingMore ?');
  expect(source).toContain('setCleanupImages(next.images)');
  expect(source).toContain('...result.images.map(({ key }) => key)');
  const cleanupListStart = source.indexOf('activeSheet === "cleanup" ? <FlatList');
  const normalSheetScroll = source.indexOf(': <ScrollView', cleanupListStart);
  expect(cleanupListStart).toBeGreaterThan(-1);
  expect(normalSheetScroll).toBeGreaterThan(cleanupListStart);
});

test("renders cleanup loading states as one horizontal four-card row", () => {
  expect(source).toContain("const IMAGE_COLUMNS = 4");
  const cleanupList = sourceSection(source, 'activeSheet === "cleanup" ? <FlatList', 'activeSheet === "similar" || similarBehindImage ? <FlatList');
  expect(cleanupList).toContain('ListEmptyComponent={cleanupLoading ? <View accessibilityLabel="Loading cleanup images" accessibilityRole="progressbar" style={styles.cleanupGridRow}>');
  expect(cleanupList).toContain('ListFooterComponent={cleanupLoadingMore ? <View accessibilityLabel="Loading more cleanup images" accessibilityRole="progressbar" style={styles.cleanupGridRow}>');
  expect(cleanupList.match(/Array\.from\(\{ length: IMAGE_COLUMNS \}/g)).toHaveLength(2);
  expect(source).toContain('cleanupGridRow: { flexDirection: "row", gap: GRID_GAP }');
  expect(source).toContain("No scored images found at this threshold.");
});

test("uses full-height destination browsers without legacy sizing props", () => {
  const sheetStart = source.indexOf('<BottomSheet', source.indexOf('<BottomSheet') + 1);
  const sheetEnd = source.indexOf('\n      >', sheetStart);
  const sheet = source.slice(sheetStart, sheetEnd);
  expect(sheet).toContain('activeSheet === "transferDestination"');
  expect(sheet).toContain('height={activeSheet === "destination"');
  expect(sheet).toContain('? "full" : undefined}');
  expect(sheet).not.toContain('mutation=');
  expect(sheet).not.toContain('tall=');
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetContent');
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll');
});

test("fills the mutation body for Gallery search history", () => {
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetContent');
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll');
  expect(source).toContain('activeSheet === "identityName" || activeSheet === "searchHistory" ? undefined : height * 0.6');
});

test("opens duplicates with exact invalidation, a direct request, cache write, and stale guards", () => {
  const start = source.indexOf("async function showDuplicates");
  const end = source.indexOf("async function deleteDuplicates", start);
  const duplicates = source.slice(start, end);
  expect(duplicates).toContain("galleryQueryKeys.duplicates(galleryContext, collectionKey)");
  expect(duplicates).toContain('invalidateQueries({ queryKey, exact: true, refetchType: "none" })');
  expect(duplicates).toContain("findGalleryCollectionDuplicates(collectionKey)");
  expect(duplicates).toContain("queryClient.setQueryData(queryKey, result)");
  expect(duplicates).toContain('isCurrentContext() && request === duplicatesRequest.current && activeSheetRef.current === "duplicates" && activeCollectionKey.current === collectionKey');
  expect(duplicates.match(/isCurrent\(\)/g)).toHaveLength(3);
  expect(source).toContain("const request = ++duplicatesRequest.current");
  expect(source).toContain('request !== duplicatesRequest.current || activeSheetRef.current !== "duplicates"');
  const refreshStart = source.indexOf('if (activeSheetRef.current === "duplicates" && currentCollection && plan.has("duplicates"))');
  const refreshEnd = source.indexOf('if (needsOverview && activeSheetRef.current === "identityPicker"', refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);
  expect(refresh).toContain("findGalleryCollectionDuplicates(collectionKey)");
  expect(refresh).toContain("const request = ++duplicatesRequest.current");
  expect(refresh).toContain("queryClient.setQueryData(queryKey, result)");
  expect(refresh).not.toContain("queryClient.fetchQuery");
});

test("shows the selected cleanup count in the visible confirmation question", () => {
  expect(source).toContain('activeSheet === "confirmCleanupDelete" ? <View');
  expect(source).toContain('activeSheet === "confirmCleanupDelete" ? `Delete ${cleanupSelectedCount === 1 ? "image" : `${cleanupSelectedCount} images`}?`');
  expect(source).not.toContain('hideHeading={activeSheet === "confirmCleanupDelete"');
});

test("restores collection search focus immediately after the Core sheet closes", () => {
  expect(source).toContain("editable={!collectionSearchFocusBlocked}");
  expect(source).toContain("collectionSearchInput.current?.blur()");
  expect(source).toContain("onFocusChange={handleCoreFocusChange}");
  expect(source).toContain("setCollectionSearchFocusBlocked(false)");
  expect(source).not.toContain("searchFocusReleaseTimer");
});

test("keeps the collection workspace owner-only", () => {
  expect(source).not.toMatch(/Shared collections|MemberIcon|confirmLeaveCollection|leaveActiveCollection|sharingOpen/);
  expect(source).toContain('const visibleCollections = filterByHiddenView(rootCollectionSource, userHiddens, "collection", viewFilters)');
  expect(source).toContain('const writableCollections = collections.filter(({ access }) => access?.canContribute)');
  expect(source).toContain('const [canCreateCollections, setCanCreateCollections] = useState(false)');
  expect(source).toContain('setCanCreateCollections(overview.canCreateCollections)');
  expect(source).toContain('<Button accessibilityLabel="Create in Gallery" contentMode="raw" disabled={loading}');
  expect(galleryClientSource).toContain('collections.filter(isVisibleCollection).map(ownerCollection)');
});

test("edits owner collection covers from existing images with tri-state changes", () => {
  expect(source).toContain('const [editCoverImageKey, setEditCoverImageKey] = useState<string | null>()');
  expect(source).toContain('updateGalleryCollection(previous.key, editName.trim(), editFavorite, editCoverImageKey)');
  expect(source).toContain('setEditCoverImageKey(identityPickerSelected.key)');
  expect(source).toContain('setEditCoverImageKey(null)');
  expect(source).toContain('if (!activeCollection || !isCollectionOwner) return');
  expect(source).toContain('openIdentityPickerCollection(activeCollection)');
  expect(source).toContain('accessibilityLabel="Clear collection cover"');
  expect(source).toContain('accessibilityLabel="Clear collection cover" contentMode="raw" disabled={busy} iconOnly');
  expect(source).toContain('collectionCoverRemove: { width: 42, height: 42, minHeight: 42');
});

test("uses covered collection cards in every collection browser and destination picker", () => {
  expect(source.match(/<CollectionCover collection=\{collection\} \/>/g)?.length).toBeGreaterThanOrEqual(4);
  expect(source.match(/collectionHasCover\(collection\) && styles\.coveredCollectionMain/g)?.length).toBeGreaterThanOrEqual(4);
  expect(source).toContain('Boolean(collection.purpose === "generated-media" || collection.presentation || collection.coverUrl)');
  expect(source).toContain('source={assistantIconSource}');
  expect(source).toContain('accessibilityLabel={`Upload to ${collection.name}`}');
  expect(source).toContain('accessibilityLabel={`${selected ? "Remove" : "Select"} ${collection.name}`}');
  expect(source).toContain('openIdentityPickerCollection(collection)');
});

test("defers workspace refreshes while mutations are busy", () => {
  expect(source).toContain('refreshCoalescer.current.takeIfReady(busyRef.current)');
  expect(source).toContain('if (!busy && refreshCoalescer.current.hasPending)');
});

test("generation-guards context changes and gates event network work", () => {
  expect(source).toContain("refreshContextGeneration.current += 1");
  expect(source).toContain("refreshCoalescer.current.reset()");
  expect(source).toContain("if (!isCurrent()) return");
  expect(source).toContain('const needsIndex = plan.has("root")');
  expect(source).toContain('if (!needsIndex && !needsOverview && !needsSubjects && !needsCleanup) return');
  expect(source).toContain("await replayOverviewWindow(activeCollection?.key, images.length, generation)");
});

test("reconciles owner capability changes and authoritatively guards submissions", () => {
  expect(source).toContain("reconcileGalleryPermissions");
  expect(source).toContain("if (permissions.closeSheet) closeSheet()");
  expect(source).toContain('!latest?.access?.canManage');
  expect(source).toContain('!destination.access?.canContribute');
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

test("uses canonical collection search with loading skeletons and no inline errors", () => {
  const start = source.indexOf("async function search(value = query.trim()");
  const end = source.indexOf("const runSearch", start);
  const search = source.slice(start, end);
  expect(search).toContain("recordHistory: Boolean(value)");
  expect(search).toContain("setCollectionSearchResults(result.images)");
  expect(search).not.toContain("result.images.filter");
  expect(search).not.toContain("imageOrigin");
  expect(search).toContain("setCollectionSearchResults([])");
  expect(search).toContain("setStatus(undefined)");
  expect(search).not.toContain("setStatus(errorMessage(error))");
  expect(search).not.toContain("immediateMatches");
  expect(source).not.toContain("historyTimer");
  expect(source).toContain('(searching || (loadingMore && showOnlyFavorites)) && visibleImages.length === 0');
  expect(source).toContain('collectionSearchActive ? (collectionSearchResults ?? []) : images');
});

test("generation-guards native selection, capture, upload, and polling paths", () => {
  expect(source).toContain("cameraContextGeneration.current = refreshContextGeneration.current");
  expect(source).toContain("const generation = cameraContextGeneration.current");
  expect(source).toContain("if (!isCurrent()) { deletePreparedFiles(files); return; }");
  expectSourceContains(source, "await wait(3_000);\n        if (!isCurrent())");
  expect(source).toContain("await prepareAssets(result.assets, generation)");
  expect(source).toContain("completeUpload(files, targetCollection.key, batchKey, generation)");
  expect(source).toContain("setPendingFiles((current) => { deletePreparedFiles(current); return []; })");
  expect(captureSource).toContain("if (!active.current) { deleteCapturedFile(normalized.uri); return; }");
});

test("closes upload surfaces when owner contribution is disabled and rechecks destinations", () => {
  expect(source).toContain("canAddImages = Boolean(activeCollection?.access?.canContribute");
  expect(source).toContain('!targetCollection?.access?.canContribute');
  expect(source).toContain('!currentCollection?.access?.canContribute');
  expect(source).toContain("setCameraOpen(false)");
});

test("replays media and picker windows and recovers contextual failures", () => {
  expect(source).toContain("replayPaginatedWindow({");
  expect(source).toContain("replayOverviewWindow(pickerCollection.key, identityPickerImages.length, generation)");
  expect(source).toContain('recoverContextualSearchFailure("identity")');
  expect(source).toContain("await replayOverviewWindow(activeCollection?.key, images.length, generation)");
});

test("centers full-sheet Gallery empty and initial load-error states", () => {
  expect(source).toContain('activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName"');
  expect(source).toContain('similarListContent: { flexGrow: 1');
  expect(source).toContain('duplicateEmpty: { flexGrow: 1, minHeight: 320, alignItems: "center", justifyContent: "center" }');
  expect(source).toContain('cleanupError && cleanupImages.length > 0');
  expect(source).toContain('{cleanupError ?? "No scored images found at this threshold."}');
  expect(source).toContain('identityError && activeSubjects.length > 0');
  expect(source).toContain('{identityError ?? "No visual identities yet."}');
});

test("uses standard-sized compact confirmations", () => {
  for (const sheet of ["confirmDeleteImage", "confirmDeleteCollection", "confirmDeleteIdentity", "bulkDelete", "confirmDeleteDuplicates", "confirmCleanupDelete"]) {
    const start = source.indexOf(`activeSheet === "${sheet}" ? <View`);
    const end = source.indexOf("</View> : null}", start);
    const confirmation = source.slice(start, end);
    expect(confirmation.match(/size="md"/g)).toHaveLength(2);
    expect(confirmation).not.toContain('size="lg"');
  }
});

test("generation-guards all Gallery mutation results and rollback paths", () => {
  expect(source).toContain("const captureGalleryContextGuard = () =>");
  expect(source).toContain("const { isCurrent } = captureGalleryContextGuard()");
  expect(source).toContain('if (!isCurrent()) throw new Error("Gallery context changed.")');
  expect(source).toContain("if (!isCurrent() || request !== viewRequest.current) return");
  expect(source).toContain("invalidateAssistantChanges(queryClient, contentContext, assistantResult.changes)");
  expect(source).not.toContain("invalidateAssistantChanges(queryClient, getContentContext()");
  expectSourceContains(source, "setBusy(false);\n    setAssistantBusy(false)");
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
