import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
const captureSource = await Bun.file(new URL("../components/capability/GalleryCaptureModal.tsx", import.meta.url)).text();
const cameraSource = await Bun.file(new URL("../components/capability/BrandedCameraModal.tsx", import.meta.url)).text();
const bottomSheetSource = await Bun.file(new URL("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx", import.meta.url)).text();
const sharingSource = await Bun.file(new URL("../components/capability/GalleryCollectionSharing.tsx", import.meta.url)).text();
const actionPillSource = await Bun.file(new URL("../../../../shared/packages/ui/components/action-pill/action-pill.mobile.tsx", import.meta.url)).text();
const memberWebSource = await Bun.file(new URL("../../../../shared/packages/ui/icons/member/member.web.tsx", import.meta.url)).text();
const memberMobileSource = await Bun.file(new URL("../../../../shared/packages/ui/icons/member/member.mobile.tsx", import.meta.url)).text();
const webIconsSource = await Bun.file(new URL("../../../../shared/packages/ui/icons.ts", import.meta.url)).text();
const mobileIconsSource = await Bun.file(new URL("../../../../shared/packages/ui/icons-mobile.ts", import.meta.url)).text();

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

test("keeps the Gallery filter sheet limited to favorite and hidden toggles", () => {
  const start = source.indexOf('activeSheet === "filter" ?');
  const filterSheet = source.slice(start, source.indexOf('activeSheet === "identityPickerFilter"', start));
  expect(filterSheet).toContain('>Favorites</Text>');
  expect(filterSheet).toContain('>Show hidden</Text>');
  expect(filterSheet).not.toContain('>Visual identities</Button>');
  expect(filterSheet).not.toContain('>Search history</Button>');
});

test("presents managed place media as readable Compass content with collection-only visibility control", () => {
  expect(source).toContain("isManagedGalleryCollection(activeCollection)");
  expect(source).toContain("capabilityIconSource.compass");
  expect(source).toContain('accessibilityLabel="Compass collection"');
  expect(source.indexOf('isManagedGalleryCollection(collection) ? <Image accessibilityLabel="Compass collection"')).toBeLessThan(source.indexOf('collection.coverUrl ? <Image source={collection.coverUrl}'));
  expect(source).toContain("!managedCollection && !isManagedGalleryImage(image)");
  expect(source).toContain("activeCollection && !managedCollection ? <GalleryHighlights");
  expect(source).toContain("activeCollection && !managedCollection ? <GalleryMemories");
  expect(source).toContain("!managedCollection ? <View style={styles.sharingRow}");
  const collectionMenuStart = source.indexOf('{activeSheet === "collectionMenu" ? <>');
  const collectionMenu = source.slice(collectionMenuStart, source.indexOf('activeSheet === "cleanupMenu"', collectionMenuStart));
  expect(collectionMenu).toContain('!managedCollection');
  expect(collectionMenu).toContain('setHiddenOptimistically("collection"');
  const imageMenuStart = source.indexOf('activeSheet === "imageActions" && selectedImage');
  const imageMenu = source.slice(imageMenuStart, source.indexOf('activeSheet === "imageEdit"', imageMenuStart));
  expect(imageMenu).toContain("Find similar image");
  expect(imageMenu).toContain("!managedCollection && !isManagedGalleryImage(selectedImage)");
  expect(source).toContain("selectedImage && (activeCollection || !isManagedGalleryImage(selectedImage))");
});

test("only lifts Core for its own focus and uses distinct image sheet presentations", () => {
  expect(source).toContain('behavior={aiInputFocused ? "height" : undefined}');
  expect(source).toContain("setAiInputFocused(focused)");
  expect(source).toContain('hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions" || activeSheet === "cleanupMenu"}');
  expect(source).toContain('open={!sharingOpen && sheetOpen && (activeSheet === "image" || activeSheet === "imageActions") && Boolean(selectedImage || selectedOptimisticItem)}');
  expect(source).toContain('height="full"\n        onOpenChange');
  expect(source).toContain('height={activeSheet === "destination" || activeSheet === "imageEdit"');
  expect(source).not.toContain('activeSheet === "imageActions" || activeSheet === "imageEdit"');
  expect(source).not.toContain("detailCaption");
  expect(source).toContain('accessibilityLabel="Open image actions"');
  expect(source).toContain('<View style={styles.detailImageFrame}>');
  expect(source).toContain('footer={<Button onPress={closeSheet} size="md" variant="secondary">Close</Button>}');
  expect(source).toContain('if (activeSheetRef.current === "imageActions") goBackSheet(); else closeSheet();');
  expect(source).toContain('mergeMediaItems([], unfilteredVisibleImages).filter');
  expect(source).toContain('detailImageFrame: { flex: 1, width: "100%" }');
  expect(bottomSheetSource).toContain('height?: "full"');
  expect(bottomSheetSource).not.toContain("mutation?: boolean");
  expect(bottomSheetSource).not.toContain("tall?: boolean");
  expect(bottomSheetSource).toContain('fullSheet: {\n    bottom: 0');
  expect(bottomSheetSource).toContain('Platform.OS === "android" ? insets.bottom : 0');
  expect(bottomSheetSource).toContain('bottom: fullHeight ? androidBottomInset');
  expect(bottomSheetSource).toContain('borderBottomLeftRadius: 24');
  expect(bottomSheetSource).toContain('borderBottomRightRadius: 24');
  expect(bottomSheetSource).not.toContain('height: fullHeight ? windowHeight - insets.top - androidBottomInset');
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
  const rootActionsStart = source.indexOf('{activeSheet === "rootActions" ? <>');
  const rootActions = source.slice(rootActionsStart, source.indexOf('activeSheet === "actions"', rootActionsStart));
  const collectionActionsStart = source.indexOf('{activeSheet === "actions" ? <>');
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
  const leave = source.slice(source.indexOf("async function leaveActiveCollection"), source.indexOf("function replaceVisibleImages"));
  expect(similar).not.toContain("setActiveIdentityFilter(undefined)");
  expect(source).toContain("const unfilteredVisibleImages = activeIdentityFilter && activeCollection");
  expect(source).not.toContain("const unfilteredVisibleImages = similarSource");
  expect(source).not.toContain("Similar to {similarSource.filename}");
  expect(source).not.toContain('accessibilityLabel="Close similar image filter"');
  expect(leave).toContain("setActiveIdentityFilter(undefined)");
  expect(leave).toContain("setSimilarSource(undefined)");
  expect(source).toContain('accessibilityLabel="Close visual identity filter"');
});

test("renders one four-card skeleton row and guarded results in the similar-images sheet", () => {
  const start = source.indexOf('activeSheet === "similar" ? <View style={styles.duplicatePanel}');
  const end = source.indexOf('activeSheet === "duplicates"', start);
  const sheet = source.slice(start, end);
  expect(sheet).toContain('accessibilityLabel="Loading similar images"');
  expect(sheet).toContain('Array.from({ length: IMAGE_COLUMNS }');
  expect(sheet).toContain('width: sheetImageSize, height: sheetImageSize');
  expect(sheet).toContain('similarImages.map((image)');
  expect(sheet).toContain('onPress={() => showSimilarImage(image)}');
  expect(sheet).toContain('No similar images found in this collection.');
});

test("uses separate image-selection and naming steps for visual identities", () => {
  expect(source).toContain('activeSheet === "identityName"');
  expect(source).toContain('imagePickerPurpose === "cover" ? chooseCollectionCover() : pushSheet("identityName")');
  expect(source).toContain('placeholder="Name"');
  expect(source).not.toContain("Name, for example Hugo");
  expect(source).toContain('accessibilityLabel="Choose a different visual identity image"');
  expect(source).toContain("returnToIdentityLibrary();");
  expect(source).toContain("width: 88, height: 88");
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll');
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
  expect(sheet).toContain('hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions" || activeSheet === "cleanupMenu"}');
});

test("provides collection cleanup discovery, pagination, exclusion, and confirmed canonical deletion", () => {
  const cleanupIcon = source.indexOf('<BrainIcon size="sm"');
  const sharingIcon = source.indexOf('<MemberIcon size="sm"');
  expect(cleanupIcon).toBeGreaterThan(-1);
  expect(cleanupIcon).toBeLessThan(sharingIcon);
  expect(source).toContain('<Button accessibilityLabel={`AI actions for ${activeCollection.name}`}');
  expect(source).toContain('{isCollectionOwner ? <BottomSheetItem onPress={() => void showCleanup()}');
  expect(source).toContain('activeSheet === "cleanupMenu" ? <>');
  expect(source).toContain('>Clean up</BottomSheetItem>');
  expect(source).toContain('activeSheet === "cleanup" ? "Clean up"');
  expect(source).toContain('Choose a quality threshold to find and remove lower-quality images. Images are scored from 1 to 100.');
  expect(source).toContain('const CLEANUP_THRESHOLDS = [10, 25, 50, 75, 90] as const');
  expect(source).toContain('fetchGalleryOverview(collection.key, cursor, 100, threshold)');
  expect(source).toContain('appendCursorItems(cached?.images ?? [], result.images');
  expect(source).toContain('accessibilityLabel={`Exclude ${image.filename} from cleanup`}');
  expect(source).toContain('setCleanupImages((current) => current.filter');
  expect(source).toContain('for (let index = 0; index < targets.length; index += DELETE_IMAGE_CHUNK_SIZE)');
  expect(source).toContain('await deleteGalleryImages(eligibleChunk.map(({ key }) => key))');
  expect(source).toContain('activeSheet === "confirmCleanupDelete" ? `Delete ${cleanupImages.length === 1 ? "image" : `${cleanupImages.length} images`}?`');
  expect(source).toContain('height={activeSheet === "destination" || activeSheet === "imageEdit" || activeSheet === "newCollection" || activeSheet === "collectionEdit" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "cleanup"');
  expect(source).toContain('!collection || !isGalleryCollectionOwned(collection)');
  expect(source).not.toContain('cleanupScore');
});

test("guards favorite collection and image deletion before optimistic state changes", () => {
  const collectionDelete = source.slice(source.indexOf("async function removeActiveCollection"), source.indexOf("async function leaveActiveCollection"));
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
  expect(duplicates).toContain('reconciled.unknownImages.length\n        ? "Some images were not deleted."');
  expect(duplicates).toContain('notify(reconciled.unknownImages.length\n        ? "Some images were not deleted"');
  expect(duplicates).toContain('notify("Duplicate deletion failed")');
  expect(duplicates).not.toContain("if (localFavorites.length) goBackSheet()");

  const bulk = source.slice(source.indexOf("function deleteSelectedImages"), source.indexOf("function completeTransfer"));
  expect(bulk).toContain("partitionFavoriteGalleryImages(targets)");
  expect(bulk).toContain("eligibleImages.length === 0");
  expect(bulk).toContain("reconcileGalleryImageDeletion(eligibleImages, result)");
  expect(bulk).toContain("targets.filter(({ key }) => !deletedKeys.has(key))");
  expect(bulk).toContain("applyAuthoritativeFavoriteImages(reconciled.favoriteImages)");
  expect(bulk).toContain('if (reconciled.unknownImages.length) setStatus("Some images were not deleted.")');
  expect(bulk).toContain('notify(reconciled.unknownImages.length\n        ? "Some images were not deleted"');
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
  expect(cleanup).toContain('notify(unknownKeys.size\n        ? "Some images were not deleted"');
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

test("settles duplicate and similar loading when event refresh supersedes the opening request", () => {
  const refreshStart = source.indexOf('if (activeSheetRef.current === "duplicates"');
  const refreshEnd = source.indexOf("if (needsOverview && activeSheetRef.current", refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);
  expect(refresh).toContain('setDuplicatesError(errorMessage(error))');
  expect(refresh).toContain('setDuplicatesLoading(false)');
  expect(refresh).toContain('setSimilarError(errorMessage(error))');
  expect(refresh).toContain('setSimilarLoading(false)');
});

test("caches cleanup thresholds for one sheet session while keeping exclusions and cursors safe", () => {
  expect(source).toContain('const cleanupExcludedKeys = useRef(new Set<string>())');
  expect(source).toContain('cleanupExcludedKeys.current.add(imageKey)');
  expect(source).toContain('result.images.filter(({ key }) => !cleanupExcludedKeys.current.has(key))');
  expect(source.match(/cleanupExcludedKeys\.current\.clear\(\)/g)).toHaveLength(3);
  expect(source).toContain('const cleanupCursorRef = useRef<string | null>(null)');
  expect(source).toContain('const cleanupLoadingRef = useRef(false)');
  expect(source).toContain('cleanupCursorRef.current = null;\n    cleanupLoadingRef.current = true;');
  expect(source).toContain('const cursor = cleanupCursorRef.current');
  expect(source).toContain('if (!collection || !isGalleryCollectionOwned(collection) || !cursor || cleanupLoadingRef.current || cleanupLoadingMoreRef.current');
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

test("invalidates and authoritatively reloads cleanup for permission and external changes", () => {
  expect(source).toContain('galleryQueryKeys.cleanups(galleryContext, collectionKey), refetchType: "none"');
  expect(source).toContain('await invalidation;\n    if (activeSheetRef.current === "cleanup"');
  expect(source).toContain('if (!busyRef.current && (plan.has("access") || plan.has("cleanup"))');
  expect(source).toContain('if (cleanupWasOpen && (plan.has("access") || plan.has("cleanup"))) invalidateCleanupLoad()');
  expect(source).toContain('const needsCleanup = cleanupWasOpen && (plan.has("access") || plan.has("cleanup"))');
  expect(source).toContain('await loadCleanupImages(cleanupThresholdRef.current, currentCollection)');
  expect(source).toContain('request === cleanupRequest.current');
  expect(source).toContain('cleanupCollectionKeyRef.current === collectionKey');
});

test("virtualizes cleanup directly and keeps later pages reachable after exclusions", () => {
  expect(source).toContain('activeSheet === "cleanup" ? <FlatList');
  expect(source).toContain('numColumns={IMAGE_COLUMNS}');
  expect(source).toContain('keyExtractor={({ key }) => key}');
  expect(source).toContain('onEndReached={() => void loadMoreCleanupImages()}');
  expect(source).toContain('ListHeaderComponent={<View style={styles.cleanupHeader}>');
  expect(source).toContain('ListEmptyComponent={cleanupLoading ?');
  expect(source).toContain('ListFooterComponent={cleanupLoadingMore ?');
  expect(source).toContain('remainingCount <= IMAGE_COLUMNS && cleanupCursorRef.current');
  expect(source).toContain('setTimeout(() => { void loadMoreCleanupImages(); }, 0)');
  const cleanupListStart = source.indexOf('activeSheet === "cleanup" ? <FlatList');
  const normalSheetScroll = source.indexOf(': <ScrollView', cleanupListStart);
  expect(cleanupListStart).toBeGreaterThan(-1);
  expect(normalSheetScroll).toBeGreaterThan(cleanupListStart);
});

test("renders cleanup loading states as one horizontal four-card row", () => {
  expect(source).toContain("const IMAGE_COLUMNS = 4");
  const cleanupListStart = source.indexOf('activeSheet === "cleanup" ? <FlatList');
  const cleanupListEnd = source.indexOf('/> : <ScrollView', cleanupListStart);
  const cleanupList = source.slice(cleanupListStart, cleanupListEnd);
  expect(cleanupList).toContain('ListEmptyComponent={cleanupLoading ? <View accessibilityLabel="Loading cleanup images" accessibilityRole="progressbar" style={styles.cleanupGridRow}>{Array.from({ length: IMAGE_COLUMNS }');
  expect(cleanupList).toContain('ListFooterComponent={cleanupLoadingMore ? <View accessibilityLabel="Loading more cleanup images" accessibilityRole="progressbar" style={styles.cleanupGridRow}>{Array.from({ length: IMAGE_COLUMNS }');
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
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetContent');
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll');
});

test("fills the mutation body for Gallery search history", () => {
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetContent');
  expect(source).toContain('(activeSheet === "destination" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll');
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
  expect(source).toContain('activeSheet === "confirmCleanupDelete" ? `Delete ${cleanupImages.length === 1 ? "image" : `${cleanupImages.length} images`}?`');
  expect(source).not.toContain('Delete {cleanupImages.length} selected image{cleanupImages.length === 1 ? "" : "s"}?');
  expect(source).not.toContain('hideHeading={activeSheet === "confirmCleanupDelete"');
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
  expect(sharingSource).toContain("async function openNativeShare");
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
  expect(source.match(/collection\.coverUrl && styles\.coveredCollectionMain/g)?.length).toBeGreaterThanOrEqual(3);
  expect(source).toContain("(collection.coverUrl || isManagedGalleryCollection(collection)) && styles.coveredCollectionMain");
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
  expect(source).toContain('if (!needsIndex && !needsOverview && !needsSubjects && !needsCleanup) return');
  expect(source).toContain("await replayOverviewWindow(activeCollection?.key, images.length, generation)");
});

test("reconciles permission downgrades and authoritatively guards submissions", () => {
  expect(source).toContain("reconcileGalleryPermissions");
  expect(source).toContain("if (permissions.closeSheet) closeSheet()");
  expect(source).toContain('!latest || !isGalleryCollectionOwned(latest) || !latest.access?.canManage');
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

test("uses semantic-only collection search with loading skeletons and no inline errors", () => {
  const start = source.indexOf("async function search(value = query.trim()");
  const end = source.indexOf("function clearCollectionSearch", start);
  const search = source.slice(start, end);
  expect(search).toContain("recordHistory: true");
  expect(search).toContain("setCollectionSearchResults(result.images)");
  expect(search).toContain("setCollectionSearchResults([])");
  expect(search).toContain("setStatus(undefined)");
  expect(search).not.toContain("setStatus(errorMessage(error))");
  expect(search).not.toContain("immediateMatches");
  expect(source).not.toContain("historyTimer");
  expect(source).toContain('searching && visibleImages.length === 0');
  expect(source).toContain('collectionSearchActive ? collectionSearchResults ?? [] : images');
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
  expect(sharingSource).toContain('size="md" style={styles.tab} variant={linkTab === "active" ? "secondary" : "ghost"}');
  expect(sharingSource).toContain(">Active links</Button>");
  expect(sharingSource).toContain(">Inactive links</Button>");
  expect(sharingSource).toContain('filterGalleryShareLinks(links, linkTab === "active")');
  expect(sharingSource).toContain('Array.from({ length: 3 }');
  expect(sharingSource).toContain("No {linkTab} share links.");
  expect(sharingSource).toContain('setLinkTab(result.link.active ? "active" : "inactive")');
});

test("uses full-height lists for collection collaboration", () => {
  expect(sharingSource).toContain('fullHeight = view === "members" || view === "invites"');
  expect(sharingSource).toContain('height={fullHeight ? "full" : undefined}');
  expect(sharingSource).toContain('dismissible={!busy}');
  expect(sharingSource).not.toContain('mutation=');
  expect(sharingSource).not.toContain('tall=');
  expect(sharingSource).toContain('if (navigate) { setInvites([]); setView("invites"); }');
  expect(sharingSource).toContain('queryKey: incomingInvitesQueryKey, exact: true, refetchType: "none"');
  expect(sharingSource).toContain('if (navigate) { setLinks([]); setLinkTab("active"); setView("links"); }');
  expect(sharingSource).toContain('size="md" style={styles.pillButton} variant="secondary"');
  expect(sharingSource).toContain('pillSkeleton: { width: "100%", minHeight: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 }');
  expect(sharingSource).toContain('list: { gap: 6, paddingBottom: spacing.xl }');
  expect(sharingSource).not.toContain('rowSkeleton');
  expect(sharingSource).not.toContain('variant="ghost"><View><Text numberOfLines={1} style={styles.name}>{link.url}');
});

test("centers full-sheet Gallery empty and initial load-error states", () => {
  expect(source).toContain('activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName"');
  expect(source).toContain('duplicateEmpty: { flexGrow: 1, minHeight: 320, alignItems: "center", justifyContent: "center" }');
  expect(source).toContain('cleanupError && cleanupImages.length > 0');
  expect(source).toContain('{cleanupError ?? "No scored images found at this threshold."}');
  expect(source).toContain('identityError && activeSubjects.length > 0');
  expect(source).toContain('{identityError ?? "No visual identities yet."}');
  expect(sharingSource).toContain('loadError && fullHeight ? <View style={styles.sheetEmptyContent}>');
  expect(sharingSource).toContain('!loading && visibleMembers.length === 0 && styles.sheetEmptyContent');
  expect(sharingSource).toContain('>No {tab} members.</Text>');
  expect(sharingSource).toContain('!loading && invites.length === 0 && styles.sheetEmptyContent');
  expect(sharingSource).toContain('>No pending invites.</Text>');
  expect(sharingSource).toContain('!loading && visibleLinks.length === 0 && styles.sheetEmptyContent');
});

test("uses standard-sized compact confirmations and collaboration notices", () => {
  for (const sheet of ["confirmDeleteImage", "confirmDeleteCollection", "confirmLeaveCollection", "confirmDeleteIdentity", "bulkDelete", "confirmDeleteDuplicates", "confirmCleanupDelete"]) {
    const start = source.indexOf(`activeSheet === "${sheet}" ? <View`);
    const end = source.indexOf("</View> : null}", start);
    const confirmation = source.slice(start, end);
    expect(confirmation.match(/size="md"/g)).toHaveLength(2);
    expect(confirmation).not.toContain('size="lg"');
  }
  expect(sharingSource).toContain('notify("Member updated")');
  expect(sharingSource).toContain('notify("Member removed")');
  expect(sharingSource).toContain('"Invite accepted" : "Invite rejected"');
  expect(sharingSource).toContain('notify("Share link created")');
  expect(sharingSource).toContain('notify("Share link updated")');
  expect(sharingSource).toContain('notify("Share link shared")');
  expect(sharingSource).toContain('onPress={() => void removeMember()} size="md"');
  expect(sharingSource).toContain('onPress={() => void respondInvite()} size="md"');
  expect(sharingSource).toContain('view === "memberRemoveConfirm" ? "Remove member?"');
  expect(sharingSource).toContain('`${inviteResponse === "accept" ? "Accept" : "Reject"} invite?`');
  expect(sharingSource).toContain('hideHeading={view === "access"}');
});

test("gates member editing to owners and keeps removal inside one shared pill", () => {
  expect(sharingSource).toContain('const owner = isGalleryCollectionOwned(collection)');
  expect(sharingSource).not.toContain('collection.role === "owner" || !collection.role');
  expect(sharingSource).toContain('if (!owner || member.role === "owner") return');
  expect(sharingSource).toContain('const editable = owner && member.role !== "owner"');
  expect(sharingSource).toContain('<ActionPill action={editable ? <CloseIcon size="sm" /> : undefined}');
  expect(sharingSource).toContain('onPress={editable ? () => openMember(member) : undefined}');
  expect(sharingSource).toContain('view === "member" && selectedMember && owner && selectedMember.role !== "owner"');
  expect(sharingSource).toContain('view === "member" ? selectedMember?.name ?? "Member"');
  expect(sharingSource).toContain('Joined {dateTime(selectedMember.joinedAt)}');
  expect(actionPillSource).toContain('style={styles.action} variant="secondary">{action}</Button>');
  expect(actionPillSource).toContain('marginRight: 6');
  expect(actionPillSource).toContain('borderRadius: 999');
});

test("keeps pending-invite rejection inside the shared pill", () => {
  expect(sharingSource).toContain('<ActionPill action={<CloseIcon size="sm" />} actionLabel={`Reject invite to ${invite.collection.name}`}');
  expect(sharingSource).toContain('onAction={() => { setSelectedInvite(invite); setInviteResponse("reject"); setView("inviteConfirm"); }}');
  expect(sharingSource).toContain('pressLabel={`Accept invite to ${invite.collection.name}`}');
  expect(sharingSource).toContain('{inviteResponse === "accept" ? "Accept" : "Reject"}</Button>');
  expect(sharingSource).toContain('inviteResponse === "accept" ? "Invite accepted" : "Invite rejected"');
});

test("uses shared tabs for editable member and share-link roles", () => {
  expect(sharingSource).toContain('function RoleTabs(');
  expect(sharingSource).toContain('<Tabs accessibilityLabel="Access role" accessibilityRole="tablist"');
  expect(sharingSource).toContain('variant={role === "viewer" ? "secondary" : "ghost"}');
  expect(sharingSource).toContain('variant={role === "collaborator" ? "secondary" : "ghost"}');
  expect(sharingSource.match(/<RoleTabs role=\{role\} setRole=\{setRole\} \/>/g)).toHaveLength(2);
  expect(sharingSource).not.toContain('function RoleButtons(');
});

test("centers every collection access menu option", () => {
  expect(sharingSource.match(/style=\{styles\.menuItem\} variant="secondary"/g)).toHaveLength(3);
  expect(sharingSource).toContain('menuItem: { justifyContent: "center" }');
});

test("keeps non-owner leave at the end of the collection menu with compact confirmation", () => {
  const menuStart = source.indexOf('{activeSheet === "collectionMenu" ? <>');
  const menuEnd = source.indexOf('{activeSheet === "cleanupMenu"', menuStart);
  const menu = source.slice(menuStart, menuEnd);
  expect(menu).toContain('isCollectionOwner ? <BottomSheetItem');
  expect(menu).toContain('pushSheet("confirmLeaveCollection")');
  expect(menu).toContain('>Leave</BottomSheetItem>');
  expect(source).toContain('activeSheet === "confirmLeaveCollection" ? "Leave collection?"');
  expect(source).toContain('onPress={() => void leaveActiveCollection()} size="md" variant="primary">Leave</Button>');
});

test("shares secure links through the native OS chooser", () => {
  expect(sharingSource).toContain('Share as NativeShare');
  expect(sharingSource).toContain('await NativeShare.share({');
  expect(sharingSource).toContain('url: link.url');
  expect(sharingSource).toContain('message: `Open ${collection.name} with this secure link: ${link.url}`');
  expect(sharingSource).toContain('result.action === NativeShare.dismissedAction');
  expect(sharingSource).toContain("if (shareWasCancelled(error)) return");
  expect(sharingSource).toContain("await openNativeShare(result.link, generation)");
  expect(sharingSource).toContain("if (result.token) await openNativeShare(result.link, generation)");
  expect(sharingSource).toContain("await openNativeShare(link, generation)");
  expect(sharingSource).not.toContain("copyToClipboard");
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
