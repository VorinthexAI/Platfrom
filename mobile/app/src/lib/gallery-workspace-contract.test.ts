import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
const captureSource = await Bun.file(new URL("../components/capability/GalleryCaptureModal.tsx", import.meta.url)).text();
const cameraSource = await Bun.file(new URL("../components/capability/BrandedCameraModal.tsx", import.meta.url)).text();
const bottomSheetSource = await Bun.file(new URL("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx", import.meta.url)).text();
const sharingSource = await Bun.file(new URL("../components/capability/GalleryCollectionSharing.tsx", import.meta.url)).text();

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
  expect(source).toContain('open={!sharingOpen && !pendingInvitesOpen && sheetOpen && (activeSheet === "image" || activeSheet === "imageActions") && Boolean(selectedImage || selectedOptimisticItem)}');
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
  expect(source).toContain('onPress={() => pushSheet("identityName")}');
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
  expect(source).toContain("<UsersIcon size=\"sm\"");
  expect(source).toContain('collectionRole === "collaborator" && image.createdByKey === activeCollection.memberKey');
  expect(source).toContain('pushSheet("confirmLeaveCollection")');
  expect(sharingSource).toContain('>Members</BottomSheetItem>');
  expect(sharingSource).toContain('>Pending invites</BottomSheetItem>');
  expect(sharingSource).toContain('Array.from({ length: 3 }');
  expect(sharingSource).toContain('title: "Share link copied to clipboard"');
  expect(sharingSource).toContain('setCachedGalleryShareLinks');
  expect(sharingSource).toContain('galleryQueryKeys.members(context, collection.key), refetchType: "none"');
  expect(sharingSource).toContain('view === "memberRemoveConfirm"');
  expect(sharingSource).toContain('active === selectedLink.active');
  expect(source).toContain('open={!sharingOpen && !pendingInvitesOpen && sheetOpen');
  expect(source).toContain('access.canContribute && role !== "viewer"');
  expect(source).toContain('accessibilityLabel="Pending Gallery invites"');
  expect(sharingSource).toContain('event.type === "collection.changed"');
  expect(sharingSource).toContain('accessibilityLabel={`Remove ${selectedMember?.name ?? "member"} from collection`}');
  expect(sharingSource).not.toContain('<View accessible accessibilityHint=');
  expect(source).toContain('const [canCreateCollections, setCanCreateCollections] = useState(false)');
  expect(source).toContain('setCanCreateCollections(overview.canCreateCollections)');
  expect(source).toContain('collectionTab === "mine" && canCreateCollections');
  expect(source).toContain('activeCollection\n    ? isCollectionOwner');
});
