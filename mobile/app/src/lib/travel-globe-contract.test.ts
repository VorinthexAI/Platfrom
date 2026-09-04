import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globe = readFileSync(new URL("../components/three/InteractiveGlobe.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");
const galleryWorkspace = readFileSync(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url), "utf8");
const knowledgeWorkspace = readFileSync(new URL("../components/capability/KnowledgeWorkspace.tsx", import.meta.url), "utf8");
const capabilityRoute = readFileSync(new URL("../app/capability/[slug].tsx", import.meta.url), "utf8");
const appSwitcher = readFileSync(new URL("../components/capability/WorkspaceAppSwitcher.tsx", import.meta.url), "utf8");
const coreComposer = readFileSync(new URL("../../../../shared/packages/ui/components/core-composer/core-composer.mobile.tsx", import.meta.url), "utf8");
const chevronDownIcon = readFileSync(new URL("../../../../shared/packages/ui/icons/chevron-down/chevron-down.mobile.tsx", import.meta.url), "utf8");
const eventBridge = readFileSync(new URL("./event-bridge.tsx", import.meta.url), "utf8");
const normalize = (source: string) => source.replace(/\s+/g, "").replace(/,([}\]])/g, "$1").replace(/\?\((?=<)/g, "?");

test("keeps the interactive globe behavior and bounded focus pulse", () => {
  expect(globe).toContain("createCountryBoundaryGeometry");
  expect(globe).toContain("createCountryFillGeometry");
  expect(globe).toContain("findCountryAtCoordinates");
  expect(globe).toContain("AUTO_ROTATION_RADIANS_PER_SECOND * delta");
  expect(globe).toContain("idle && autoRotate && !reducedMotion");
  expect(globe).toContain("FOCUS_PULSE_DURATION_MS = 2_600");
  expect(globe).toContain('frameloop="demand"');
  expect(globe).not.toContain("PlaceMarker");
  expect(workspace).toContain("autoRotate={!countryQuery.trim()}");
  expect(workspace).toContain("savedCountryCodes={savedCountryCodes}");
});

test("toggles between globe and table with shared view icons", () => {
  expect(workspace).toContain('type RootView = "globe" | "table"');
  expect(workspace).toContain("rootView === \"globe\" ? <TableViewIcon");
  expect(workspace).toContain(": <GlobeViewIcon");
  expect(workspace).toContain('accessibilityLabel={rootView === "globe" ? "Show Compass table" : "Show Compass globe"}');
  expect(workspace).not.toContain("Recent places");
  expect(workspace).toContain("Search history");
  expect(workspace).toContain("Places");
  expect(workspace).toContain('accessibilityLabel={`Filter ${tableTab === "places" ? "Places" : "Trips"}`}');
});

test("renders Places and Trips tabs as exact three-column root grids", () => {
  expect(workspace).toContain('type TableTab = "places" | "trips"');
  expect(workspace).toContain('>Places</Button>');
  expect(workspace).toContain('>Trips</Button>');
  expect(workspace).toContain("Math.floor(((tableGridWidth || fallbackGridWidth) - GRID_GAP * 2) / 3)");
  expect(workspace).toContain("Math.floor(((tripGridWidth || fallbackGridWidth) - GRID_GAP * 2) / 3)");
  expect(workspace).toContain("compassQueryKeys.trips(travelContext)");
  expect(workspace).toContain("listTrips(signal)");
  expect(workspace).toContain("Array.from({ length: 3 }");
  expect(workspace).toContain("trip.coverUrl");
  expect(workspace).toContain("trip.name");
});

test("offers exactly two headerless creation actions with the standard sheet close control", () => {
  const addSheet = workspace.slice(workspace.indexOf('<BottomSheet hideHeading onOpenChange={setActionsOpen}'), workspace.indexOf('<BottomSheet hideHeading onOpenChange={setPlaceBulkMenuOpen}'));
  expect(addSheet).toContain(">Find place</BottomSheetItem>");
  expect(addSheet).toContain(">Create trip</BottomSheetItem>");
  expect(addSheet.match(/<BottomSheetItem/g)).toHaveLength(2);
  expect(addSheet).toContain('style={styles.sheetAction} variant="secondary"');
  expect(addSheet).not.toContain("hideCloseButton");
  expect(addSheet).not.toContain("icon={");
  expect(addSheet).not.toContain("Browse");
});

test("creates trips in three full-screen steps with complete optimistic fields", () => {
  expect(workspace).toContain('open={tripSelectionOpen} title="Choose places"');
  expect(workspace).toContain('open={tripOrderOpen} title="Order Places"');
  expect(workspace).toContain('open={tripDetailsOpen} title="Name trip"');
  expect(workspace).toContain("selectedPlaceKeys.length === 0");
  expect(workspace).toContain("current.length < 100 ? [...current, key]");
  expect(workspace).toContain('disabled ? "Saving" : selectable ? selected ? "Deselect" : "Select" : "Open"');
  expect(workspace).toContain('place={place} selectable selected={selectedPlaceKeys.includes(place.key)}');
  expect(workspace).toContain('disabled={saving}');
  expect(workspace).toContain('key.startsWith("optimistic-")');
  expect(workspace).toContain("selected && styles.squareCardSelected");
  expect(workspace).toContain("selectionBadge");
  expect(workspace).toContain('maxLength={255}');
  expect(workspace).toContain('Description (Optional)');
  expect(workspace).toContain('maxLength={10000} multiline');
  expect(workspace).toContain('placeholder="What belongs in this trip?"');
  expect(workspace).toContain("tripDescriptionInput: { minHeight: 120 }");
  expect(workspace).toContain("selectedPlaceKeys.map((key)");
  expect(workspace).toContain("selectedPlaces.length !== selectedPlaceKeys.length");
  expect(workspace).toContain('title: "One or more selected places are no longer available"');
  expect(workspace).toContain("setOrderPlaceKeys(selectedPlaceKeys)");
  expect(workspace).toContain("places: selectedPlaces");
  expect(workspace).toContain('updatedAt: now, status: "planned", isFavorite: false, attachments: []');
  expect(workspace).toContain("cancelQueries({ queryKey: tripsKey, exact: true })");
  expect(workspace).toContain("appendOptimisticCompassTrip(current, optimisticTrip)");
  expect(workspace).toContain("reconcileOptimisticCompassTrip(current, optimisticKey, trip)");
  expect(workspace).toContain("removeOptimisticCompassTrip(current, optimisticKey)");
  expect(workspace).not.toContain("previousTrips");
});

test("adds only new saved places to a selected trip from a separate titleless menu", () => {
  expect(workspace).toContain('<BottomSheet hideHeading onOpenChange={setTripAddMenuOpen} open={tripAddMenuOpen} title="">');
  expect(workspace).toContain(">Add places</BottomSheetItem>");
  expect(workspace).toContain('open={tripAddPlacesOpen} title="Choose places"');
  expect(workspace).toContain('places.filter((place) => !selectedTrip.places.some(({ key }) => key === place.key))');
  expect(workspace).toContain('accessibilityLabel="Places available to add to this trip"');
  expect(workspace).toContain('selectedTripAddPlaceKeys.includes(place.key)');
  expect(workspace).toContain('places: [...current.places, ...additions.filter(({ key }) => !current.places.some((place) => place.key === key))]');
  expect(workspace).toContain('updateTrip({ tripKey, placeKeys: optimistic.places.map(({ key }) => key) })');
  expect(workspace).toContain(">All saved places are already in this trip.</Text>");
});

test("does not record generated Find Place results in recent history", () => {
  expect(workspace).toContain('detailSource === "createPlace" || !countryDetailEnabled');
  expect(workspace).toContain('detailSource === "createPlace" || !cityDetailEnabled');
  expect(workspace).toContain("openPlace(countryDetail.location.name");
  expect(workspace).toContain("openPlace(cityDetail.location.name");
  expect(workspace).toContain('openCountryDetail({ ...country, name: result.name }, "createPlace")');
  expect(workspace).toContain('openCityDetail({ name: result.name, latitude: result.lat, longitude: result.long }, country, "createPlace")');
});

test("orders places with shared round chevrons, wrapping moves, and bulk remove", () => {
  expect(workspace).toContain('export function reorderPlaces<T>');
  expect(workspace).toContain('(index - 1 + items.length) % items.length');
  expect(workspace).toContain('(index + 1) % items.length');
  expect(workspace).toContain('scrollToEnd({ animated: true })');
  expect(workspace).toContain('scrollTo({ y: 0, animated: true })');
  expect(workspace).toContain('<ChevronUpIcon size="sm" />');
  expect(workspace).toContain('<ChevronDownIcon size="sm" />');
  expect(chevronDownIcon).toContain('d="m6 9 6 6 6-6"');
  expect(workspace).toContain('iconOnly onPress={() => moveOrderPlace(index, "up")} size="md" style={[styles.orderControl, styles.sheetSecondary]} variant="secondary"');
  expect(workspace).toContain('iconOnly onPress={() => moveOrderPlace(index, "down")} size="md" style={[styles.orderControl, styles.sheetSecondary]} variant="secondary"');
  expect(workspace).toContain('orderButtons: { flexDirection: "row"');
  expect(workspace).toContain('orderPill: { height: 48');
  expect(workspace).toContain('orderHero: { width: 32, height: 32');
  expect(workspace).toContain('orderControl: { width: 32, height: 32, minHeight: 32');
  expect(workspace).toContain('bulkToolbar: { width: "100%", minHeight: 36, marginBottom: spacing.xs, padding: 3');
  expect(workspace).toContain('backgroundColor: palette.page');
  expect(workspace).toContain('accessibilityActions={[{ name: "longpress"');
  expect(workspace).toContain("Haptics.selectionAsync()");
  expect(workspace).toContain('function OrderBulkToolbar');
  expect(workspace).toContain('onMore={() => setOrderBulkMenuOpen(true)}');
  expect(workspace).toContain('accessibilityLabel="Selected trip place actions"');
  expect(workspace).toContain('openPlaceTags(selectedOrderPlaceKeys, () => setOrderBulkMenuOpen(false))');
  expect(workspace).toContain('delaySheetTransition(() => setOrderRemoveOpen(true))');
  expect(workspace).toContain('title="Remove places?"');
  expect(workspace).toContain('onPress={removeSelectedOrderPlaces} size="md" variant="primary">Remove</Button>');
  expect(workspace).toContain("orderBulkMenuOpen");
  expect(workspace).toContain("if (!remaining.length)");
  expect(workspace).toContain('title: "A trip must contain at least one place"');
});

test("opens shared-button trip cards as a local cache-derived detail with ordered grids", () => {
  expect(workspace).toContain('const selectedTrip = selectedTripKey ? trips.find(({ key }) => key === selectedTripKey)');
  expect(workspace).toContain('function TripCard({ cardSize, onPress, trip }');
  expect(workspace).toContain('accessibilityLabel={`Open ${trip.name}, ${trip.status}${trip.isFavorite ? ", favorite" : ""}`}');
  const tripCard = workspace.slice(workspace.indexOf("function TripCard"), workspace.indexOf("function BulkToolbar"));
  expect(tripCard).toContain('trip.isFavorite ? <View pointerEvents="none" style={styles.stateBadges}><StarIcon');
  expect(tripCard).not.toContain('trip.status === "completed"');
  expect(tripCard).not.toContain("<CheckIcon");
  expect(workspace).toContain('accessibilityLabel="Back to trips"');
  expect(workspace).toContain('accessibilityLabel="Trip menu"');
  expect(workspace).toContain('accessibilityLabel="Add to trip"');
  expect(workspace).toContain('style={styles.detailHeaderActions}');
  expect(workspace).toContain('titleRow: { minHeight: 40, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs }');
  expect(workspace).toContain('detailHeaderActions: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }');
  expect(workspace).toContain('workspaceTitle: { flex: 1, minWidth: 0, color: palette.silver50, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 }');
  expect(workspace).toContain('<CoreComposer accessory={rootView === "globe" && !selectedPlace && !selectedTrip && selectedCountry && !countryDetailOpen && !cityDetailOpen');
  expect(workspace).not.toContain('!selectedTrip && !loadError ? <CoreComposer');
  expect(workspace).toContain('accessibilityLabel="Trip detail categories"');
  expect(workspace).toContain('>Places</Button>');
  expect(workspace).toContain('>Generated Images</Button>');
  expect(workspace).toContain('selectedTripPlaceKeys.length ? <BulkToolbar');
  expect(workspace).toContain(': null}\n        <Tabs accessibilityLabel="Trip detail categories"');
  expect(workspace).toContain("Math.floor(((tripGridWidth || fallbackGridWidth) - GRID_GAP * 3) / 4)");
  expect(workspace).toContain('accessibilityLabel="Trip images"');
  expect(workspace).toContain("const tripImages = useMemo");
  expect(workspace).toContain("coverUrl ? [{ key, title, url: coverUrl }] : []");
  expect(workspace).toContain("setImageViewerKey(image.key)");
  expect(workspace).toContain('title={imageViewer?.title ?? "Image"}');
});

test("wraps the whole-sheet trip image viewer and preserves generated-image proportions", () => {
  expect(workspace).toContain("(imageViewerIndex + offset + tripImages.length) % tripImages.length");
  expect(workspace).toContain('onSwipeLeft={tripImages.length > 1 ? () => focusTripImage(1) : undefined}');
  expect(workspace).toContain('onSwipeRight={tripImages.length > 1 ? () => focusTripImage(-1) : undefined}');
  expect(workspace).toContain('pageKey={imageViewer?.key}');
  expect(workspace).not.toContain("imageViewerScrollRef");
  expect(workspace).toContain('{ name: "decrement", label: "Previous image" }');
  expect(workspace).toContain('{ name: "increment", label: "Next image" }');
  expect(workspace).toContain('accessibilityValue={{ text: `${imageViewerIndex + 1} of ${tripImages.length}` }}');
  expect(workspace).toContain('viewerFrame: { width: "100%", aspectRatio: 3 / 2');
  expect(workspace).toContain('borderRadius: radii.lg');
  expect(workspace).toContain('<Image contentFit="contain" source={imageViewer.url}');
  expect(workspace).not.toContain('style={styles.viewerControls}');
  expect(workspace).not.toContain('styles.viewerPosition');
});

test("toggles trip table and globe views with Compass markers and an arc place selector", () => {
  expect(workspace).toContain('accessibilityLabel={tripView === "globe" ? "Show trip table" : "Show trip globe"}');
  expect(workspace).toContain('tripDetailTab === "images" ? <ScrollView accessibilityLabel="Trip images"');
  expect(workspace).toContain(': tripView === "globe" ? <View style={styles.tripGlobe}><InteractiveGlobe');
  expect(workspace).toContain("markers={selectedTrip.places}");
  expect(workspace).toContain("onMarkerPress={selectTripGlobePlace}");
  expect(workspace).toContain('const [tripView, setTripView] = useState<RootView>("globe")');
  expect(workspace).not.toContain('markers={selectedTrip.places} onMarkerPress={selectTripGlobePlace} savedCountryCodes=');
  expect(workspace).not.toContain('selectedCountryCode={tripGlobePlace?.countryCode}');
  expect(workspace).toContain('<TripPlaceArc onFocus={selectTripGlobePlace} onOpen={handleTripPlacePress} places={selectedTrip.places}');
  expect(workspace).toContain('if (!places.length) return <View accessibilityLabel="Trip has no places"');
  expect(workspace).toContain('accessibilityLabel="Trip places on globe"');
  expect(workspace).toContain('const slots = [-1, 0, 1].map');
  expect(workspace).toContain('accessibilityLabel="Previous place"');
  expect(workspace).toContain('accessibilityLabel="Next place"');
  expect(workspace).toContain('onMoveShouldSetPanResponder');
  expect(workspace).toContain('onMoveShouldSetPanResponderCapture');
  expect(workspace).toContain('onPress={() => onOpen(place)}');
  expect(workspace).toContain('styles.tripPlaceArcCard, place.coverUrl && styles.coveredCardMain');
  expect(workspace).not.toContain('styles.tripPlaceArcCard, styles.cardMain');
  expect(workspace).toContain('tripPlaceArcCard: { width: 86, height: 86, overflow: "hidden", flexDirection: "column"');
  expect(workspace).toContain('style={[styles.cardLabel, place.coverUrl && styles.coveredCardLabel]}');
  expect(workspace).not.toContain('tripPlaceArcName:');
  expect(workspace).toContain('source={capabilityIconSource.compass}');
  expect(workspace.indexOf('accessibilityLabel="Trip detail categories"')).toBeLessThan(workspace.indexOf('tripView === "globe" ? <View'));
  expect(globe).toContain('markers?: readonly Readonly<{ key: string; latitude: number; longitude: number }>[]');
  expect(globe).toContain('COMPASS_MARKER_RGBA_BASE64');
  expect(globe).toContain('<planeGeometry args={[0.078, 0.078]} />');
  expect(globe).toContain('map={markerTexture}');
  expect(workspace).toContain('tripPlaceArc: { position: "absolute", right: 0, bottom: 0, left: 0, height: 132, justifyContent: "flex-end", backgroundColor: "transparent" }');
  expect(workspace).not.toContain('tripPlaceArcShade');
  expect(globe).not.toContain("<octahedronGeometry");
  expect(globe).toContain("onMarkerPress?.(marker.key)");
});

test("keeps the root search lane fixed when switching Compass layouts", () => {
  expect(workspace).toContain('rootActions: { minHeight: 52, marginTop: -spacing.xs, flexDirection: "row", alignItems: "center", gap: 8 }');
  expect(workspace).toContain('workspaceSearch: { minHeight: 44');
  expect(workspace).toContain('rootSearch: { minHeight: 44');
});

test("matches the Archive root title geometry in globe and table layouts", () => {
  expect(workspace).toContain('<View style={styles.compassRoot}><View style={styles.rootTitleRow}>');
  expect(workspace).toContain('<WorkspaceAppSwitcher active="compass" trigger="back" />');
  expect(workspace).toContain('<Text numberOfLines={1} style={styles.rootTitle}>Compass</Text>');
  expect(workspace).toContain('rootTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 }');
  expect(workspace).toContain('rootTitle: { minWidth: 0, flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 }');
  expect(workspace).toContain('compassRoot: { flex: 1, minHeight: 0, gap: spacing.md }');
  expect(workspace).toContain('tableView: { flex: 1, minHeight: 0, position: "relative", gap: spacing.md }');
  expect(knowledgeWorkspace).toContain('folderTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 }');
  expect(knowledgeWorkspace).toContain('folderTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 }');
});

test("uses compact controls without changing Core sizing when the page opens", () => {
  expect(coreComposer).toContain('size="sm"');
  expect(coreComposer).not.toContain('size={expanded ? "md" : "sm"}');
  expect(coreComposer).not.toContain("expandedSend");
  expect(knowledgeWorkspace).toContain('contentMode="raw" onPress={() => setSimilarContentTab("documents")}');
  expect(knowledgeWorkspace).toContain('<Text numberOfLines={1} style={styles.similarTabText}>Documents</Text>');
});

test("serializes and version-gates every persisted trip mutation without loading UI", () => {
  expect(workspace).toContain("const tripMutationVersion = useRef(new Map<string, number>())");
  expect(workspace).toContain("const tripMutationQueue = useRef(new Map<string, Promise<void>>())");
  expect(workspace).toContain("function enqueueTripMutation<T>");
  expect(workspace).toContain("previous.catch(() => undefined).then(operation)");
  expect(workspace).toContain("tripMutationVersion.current.get(tripKey) === version");
  expect(workspace).toContain("optimisticTripUpdate(tripKey");
  expect(workspace).toContain("isFavorite: editTripFavorite, placeKeys");
  expect(workspace).toContain("setTripAttachments({ tripKey, attachments })");
  expect(workspace).toContain("return deleteTrip(tripKey)");
  const tripMenu = workspace.slice(workspace.indexOf('<BottomSheet hideHeading onOpenChange={setTripMenuOpen}'), workspace.indexOf('title="Delete trip?"'));
  expect(tripMenu).not.toContain("hideCloseButton");
  expect(workspace).toContain(">Edit</BottomSheetItem>");
  expect(workspace).not.toContain(">Order places</BottomSheetItem>");
  expect(workspace).toContain("setOrderPlaceKeys(selectedTrip.places.map(({ key }) => key))");
  expect(workspace).toContain(">Place order</Text>");
  expect(workspace).toContain(">Show assets</BottomSheetItem>");
  expect(workspace).toContain('title="Delete trip?"');
  expect(workspace).not.toContain("mutation.isPending");
  expect(workspace).not.toContain("mutation.isLoading");
});

test("writes trip changes immediately while cancelling stale queries and handling superseded failures", () => {
  const optimisticUpdate = workspace.slice(workspace.indexOf("function optimisticTripUpdate"), workspace.indexOf("function moveOrderPlace"));
  expect(optimisticUpdate).toContain("const optimisticReady = queryClient.cancelQueries({ queryKey: compassQueryKeys.trips(travelContext), exact: true })");
  expect(optimisticUpdate.indexOf("upsertCachedCompassTrip")).toBeLessThan(optimisticUpdate.indexOf("queryClient.cancelQueries"));
  expect(optimisticUpdate).toContain("convergeTripsAfterAmbiguousFailure(tripKey, version)");
  expect(optimisticUpdate).toContain("optimisticTripRef.current.set(tripKey, optimistic)");
  const create = workspace.slice(workspace.indexOf("function submitTrip"), workspace.indexOf("function delaySheetTransition"));
  expect(create.indexOf("await queryClient.cancelQueries")).toBeLessThan(create.indexOf("appendOptimisticCompassTrip"));
});

test("derives rapid attachment toggles from the current draft selection", () => {
  const toggle = workspace.slice(workspace.indexOf("function toggleAssetAttachment"), workspace.indexOf("function handleAssetLongPress"));
  expect(toggle).toContain("setSelectedAssetAttachments((current) =>");
  expect(toggle).toContain("current.some(({ type, key }) => type === attachment.type && key === attachment.key)");
  expect(toggle).toContain("[...current, attachment]");
  expect(workspace).toContain("optimisticTripRef.current.set(tripKey, optimistic)");
});

test("authoritatively converges ambiguous update, attachment, and delete failures", () => {
  const convergence = workspace.slice(workspace.indexOf("async function convergeTripsAfterAmbiguousFailure"), workspace.indexOf("function optimisticTripUpdate"));
  expect(convergence).toContain("await queryClient.cancelQueries({ queryKey: tripsKey, exact: true })");
  expect(convergence).toContain("queryClient.fetchQuery({ queryKey: tripsKey, queryFn: ({ signal }) => listTrips(signal), staleTime: 0 })");
  expect(convergence).toContain("authoritative.find(({ key }) => key === tripKey)");
  expect(convergence).toContain("const currentVersion = tripMutationVersion.current.get(tripKey)");
  expect(convergence).toContain("currentVersion !== failedVersion");
  expect(convergence).toContain("optimisticTripDeleteVersion.current.get(tripKey) === currentVersion");
  expect(convergence).toContain("if (newerDelete)");
  expect(convergence).toContain("queryClient.invalidateQueries({ queryKey: tripsKey, exact: true })");
  const deletion = workspace.slice(workspace.indexOf("function confirmDeleteTrip"), workspace.indexOf("function openAssets"));
  expect(deletion).toContain("convergeTripsAfterAmbiguousFailure(tripKey, version)");
  expect(deletion.indexOf("await queryClient.cancelQueries")).toBeLessThan(deletion.indexOf("removeCachedCompassTrip"));
  expect(workspace).toContain("const selectedTrip = selectedTripKey ? trips.find(({ key }) => key === selectedTripKey) : undefined");
  expect(workspace).not.toContain("restored.splice");
});

test("edits trip metadata and cover with the shared switch and Gallery cover pipeline", () => {
  expect(workspace).toContain('title="Edit trip"');
  expect(workspace).toContain('<Switch accessibilityLabel="Favorite trip"');
  expect(workspace).toContain("ImagePicker.launchImageLibraryAsync");
  expect(workspace).toContain("normalizeCapturedPng(coverChange");
  expect(workspace).toContain('filename: `trip-cover-${Date.now()}.png`');
  expect(workspace).toContain('processingMode: "cover"');
  expect(workspace).toContain("fetchGalleryUploadStatus([job.key])");
  expect(workspace.indexOf("uploadedImageKey = job.imageKey")).toBeLessThan(workspace.indexOf("fetchGalleryUploadStatus([job.key])"));
  expect(workspace).toContain("coverImageKey = null");
  expect(workspace).toContain('accessibilityLabel="Remove trip cover"');
  expect(workspace).toContain('style={styles.tripDetailsCoverButton} variant="secondary"');
  expect(workspace).toContain('style={styles.tripDetailsCoverRemove} variant="secondary"');
  expect(workspace).not.toContain('style={[styles.tripDetailsCoverRemove, styles.sheetSecondary]}');
  expect(workspace).toContain('tripDetailsCoverControl: { width: 88, height: 88');
  expect(workspace).toContain('tripDetailsCoverButton: { width: 88, height: 88');
  expect(workspace).not.toContain('>Choose cover</Button>');
  expect(workspace).not.toContain('>Clear cover</Button>');
  expect(workspace).toContain("description: description ?? null");
  expect(workspace).toContain("uploadedImageKey && !updateStarted");
  expect(workspace).not.toContain("const superseded = tripMutationVersion.current.get(tripKey) !== mutationVersion");
});

test("optimistically manages Places status, favorites, bulk actions, and filters", () => {
  expect(workspace).toContain('>Places</Button>');
  expect(workspace).toContain('tableTab === "places" ? "Search Places" : "Search Trips"');
  expect(workspace).toContain('maxLength={500} onChangeText={setPlaceTableQuery}');
  expect(workspace).toContain('setPlaceTableQuery(item.query.slice(0, 500))');
  expect(workspace).toContain('style={styles.rootSearch}');
  expect(workspace).toContain('style={styles.searchHistoryButton}');
  expect(workspace).not.toContain("BookmarkIcon");
  expect(workspace).toContain('accessibilityLabel={`Filter ${tableTab === "places" ? "Places" : "Trips"}`}');
  expect(workspace).toContain('<BottomSheet hideHeading onOpenChange={setTableFilterOpen}');
  expect(workspace).toContain('>Want to go</Text>');
  expect(workspace).toContain('>Visited</Text>');
  expect(workspace).toContain('>Completed trips</Text>');
  expect(workspace).toContain('setTripFavoritesOnly(checked)');
  expect(workspace).toContain('(!placeFavoritesOnly || place.isFavorite)');
  expect(workspace).toContain('(!tripFavoritesOnly || trip.isFavorite)');
  expect(workspace).toContain('setTripCompletedOnly(checked)');
  expect(workspace).toContain('>No trips match these filters.</Text>');
  expect(workspace).toContain('setPlaceStatusFilter(checked ? "wishlist" : "all")');
  expect(workspace).toContain('setPlaceStatusFilter(checked ? "visited" : "all")');
  expect(workspace).toContain('>Search history</Button>');
  expect(workspace).toContain('height="full" onOpenChange={(open) =>');
  expect(workspace).toContain('getUserSearchHistory(queryClient, contentContext)');
  expect(workspace).toContain('deleteContentSearchHistory(item.normalizedQuery)');
  expect(workspace).toContain('onLongPress={() => handleTablePlaceLongPress(place.key)}');
  expect(workspace).toContain('>Mark as visited</BottomSheetItem>');
  expect(workspace).toContain('>Mark as want to go</BottomSheetItem>');
  expect(workspace).toContain('>{allSelectedPlacesFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>');
  expect(workspace).toContain('isFavorite: !allSelectedPlacesFavorite');
  expect(workspace).not.toContain("PlaceFavoriteControl");
  expect(workspace).toContain('optimisticPlaceRef.current.set(place.key, optimistic)');
  expect(workspace.indexOf('cancelQueries({ queryKey: compassQueryKeys.all(travelContext)')).toBeLessThan(workspace.indexOf('patchCachedCompassPlace(queryClient, travelContext, optimisticPlaceRef.current.get(place.key) ?? optimistic)'));
  expect(workspace.indexOf('patchCachedCompassPlace(queryClient, travelContext, optimisticPlaceRef.current.get(place.key) ?? optimistic)')).toBeLessThan(workspace.indexOf('updatePlace({ placeKey: place.key, ...patch })'));
  expect(workspace).toContain("authoritativePlaceRef.current.set(place.key, updated)");
  expect(workspace).toContain("placeMutationVersion.current.get(previous.key) === version");
  expect(workspace).toContain("setSelectedPlaceSnapshot((current) => current?.key === updated.key ? updated : current)");
  expect(workspace).toContain('selectionComplete && results.some(({ status }) => status === "rejected")');
  expect(workspace).not.toContain('placeMutationKey');
  expect(workspace).toContain('selectedTrip?.status === "completed" ? "Mark as planned" : "Mark as completed"');
  expect(workspace).toContain('"Places marked as visited"');
  expect(workspace).toContain('"Places marked as want to go"');
  expect(workspace).toContain('"Places favorited"');
  expect(workspace).toContain('"Places unfavorited"');
});

test("marks completed trip places visited and confirms Compass mutations", () => {
  expect(workspace).toContain('places: status === "completed" ? current.places.map((place) => ({ ...place, status: "visited" })) : current.places');
  expect(workspace).toContain('for (const place of result.value.places) patchCachedCompassPlace(queryClient, travelContext, place)');
  expect(workspace).toContain('showToast({ title: "Trip created"');
  expect(workspace).toContain('"Trip completed and places marked as visited"');
  expect(workspace).toContain('"Trip marked as planned"');
  expect(workspace).toContain('"Trip updated"');
  expect(workspace).toContain('showToast({ title: "Trip deleted"');
  expect(workspace).toContain('"Places removed from trip"');
  expect(workspace).toContain('"Trip assets updated"');
});

test("shows Compass success feedback before mutation APIs settle", () => {
  const create = workspace.slice(workspace.indexOf("function submitTrip"), workspace.indexOf("function delaySheetTransition"));
  expect(create.indexOf('showToast({ title: "Trip created"')).toBeLessThan(create.indexOf("await createTrip"));

  const singlePlace = workspace.slice(workspace.indexOf("function updateSelectedPlace"), workspace.indexOf("function openPlaceDelete"));
  expect(singlePlace.indexOf("showToast({ title: successTitle")).toBeLessThan(singlePlace.indexOf("updateSavedPlace(selectedPlace, patch)"));

  const history = workspace.slice(workspace.indexOf("async function removePlaceHistoryQuery"), workspace.indexOf("function toggleTripPlace"));
  expect(history).not.toContain('showToast({ title: "Search removed"');

  const guide = workspace.slice(workspace.indexOf("async function createTripGuide"), workspace.indexOf("function openPlaceReferences"));
  expect(guide.indexOf('showToast({ title: "Travel guide request complete"')).toBeGreaterThan(guide.indexOf("await generateTripGuide"));

  const deletion = workspace.slice(workspace.indexOf("function confirmDeleteTrip"), workspace.indexOf("function beginAssetSelection"));
  expect(deletion.indexOf('showToast({ title: "Trip deleted"')).toBeLessThan(deletion.indexOf("deleteTrip(tripKey)"));
});

test("semantically searches saved places or trips from the active table tab", () => {
  expect(workspace).toContain("export const PLACE_SEARCH_DEBOUNCE_MS = 300");
  expect(workspace).toContain("export const PLACE_SEARCH_HISTORY_DEBOUNCE_MS = 800");
  expect(workspace).toContain("compassQueryKeys.placeSearch(travelContext, tableSearchTerm, selectedTagKeys)");
  expect(workspace).toContain("searchPlaces(tableSearchTerm, signal, false, selectedTagKeys)");
  expect(workspace).toContain("compassQueryKeys.tripSearch(travelContext, tableSearchTerm, selectedTagKeys)");
  expect(workspace).toContain("searchTrips(tableSearchTerm, signal, false, selectedTagKeys)");
  expect(workspace).toContain('tableTab === "places" ? searchPlaces(query, controller.signal, true, selectedTagKeys) : searchTrips(query, controller.signal, true, selectedTagKeys)');
  expect(workspace).toContain("}, PLACE_SEARCH_HISTORY_DEBOUNCE_MS)");
  expect(workspace).toContain('tableTab === "places" ? "Search Places" : "Search Trips"');
  expect(workspace.indexOf("styles.rootActions")).toBeLessThan(workspace.indexOf('accessibilityLabel="Compass table categories"'));
});

test("applies session tags only to the saved Places and Trips table", () => {
  expect(workspace).toContain('const tagContextKey = tagFilterContextKey(contentContext)');
  expect(workspace).toContain('state.selectedTagsByContext[tagContextKey] ?? EMPTY_SELECTED_TAGS');
  expect(workspace).toContain('<TagFilterLane context={contentContext} />');
  expect(workspace).toContain('<TagFilterSheet context={contentContext} onClose={() => setTagFilterOpen(false)} open={tagFilterOpen} />');
  expect(workspace).toContain('searchPlaces(tableSearchTerm, signal, false, selectedTagKeys)');
  expect(workspace).toContain('searchTrips(tableSearchTerm, signal, false, selectedTagKeys)');
  expect(workspace).toContain('const candidates = savedTableSearchActive ? savedPlaceSearchQuery.data ?? [] : places');
  expect(workspace).toContain('const candidates = savedTableSearchActive ? tripSearchQuery.data ?? [] : trips');
  expect(workspace).toContain('(!placeFavoritesOnly || place.isFavorite)');
  expect(workspace).toContain('(!tripFavoritesOnly || trip.isFavorite)');
  expect(workspace).toContain('>Tags</BottomSheetItem>');
  expect(workspace.match(/<TagFilterLane context=\{contentContext\} \/>/g)).toHaveLength(1);
  expect(workspace).toContain('findPlaces(query, controller.signal)');
  expect(workspace).toContain('searchCountries(query, controller.signal)');
});

test("keeps place card covers cached across refreshed signed URLs", () => {
  const placeCard = workspace.slice(workspace.indexOf("function PlaceCard"), workspace.indexOf("function TripPlaceArc"));
  expect(placeCard).toContain('cachePolicy="memory-disk"');
  expect(placeCard).toContain('priority="high"');
  expect(placeCard).toContain('cacheKey: `compass-place-cover:${place.key}`');
});

test("links all user folders and collections and opens exact assets in their apps", () => {
  expect(workspace).toContain('open={assetsOpen} title="Show Assets"');
  expect(workspace).toContain('>Folders</Button>');
  expect(workspace).toContain('>Collections</Button>');
  expect(workspace).toContain("queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext))");
  expect(workspace).toContain("queryClient.getQueryData<GalleryCollection[]>(galleryQueryKeys.collections(travelContext))");
  expect(workspace).toContain("getContentFolderTree(queryClient, contentContext)");
  expect(workspace).toContain("getGalleryCollections(queryClient, travelContext");
  expect(workspace).toContain("!isManagedGalleryCollection(collection)");
  expect(workspace).toContain("setTripAttachments({ tripKey, attachments })");
  expect(workspace).toContain('description="Press and hold to edit linked assets."');
  expect(workspace).toContain("onLongPress={() => handleAssetLongPress(attachment)}");
  expect(workspace).toContain('router.replace({ pathname: "/capability/[slug]"');
  expect(workspace).toContain("assetKey: attachment.key, returnTripKey: selectedTrip.key, returnTripName: selectedTrip.name");
  expect(capabilityRoute).toContain("initialFolderKey={params.assetKey}");
  expect(capabilityRoute).toContain("initialCollectionKey={params.assetKey}");
  expect(capabilityRoute).toContain("returnTripName={params.returnTripName}");
  expect(knowledgeWorkspace).toContain('params: { slug: "compass", tripKey: returnTripKey, openTripAssets: "1" }');
  expect(galleryWorkspace).toContain('params: { slug: "compass", tripKey: returnTripKey, openTripAssets: "1" }');
  expect(knowledgeWorkspace).toContain('accessibilityLabel={`Back to ${returnTripName ?? "trip"} assets`}');
  expect(galleryWorkspace).toContain('accessibilityLabel={`Back to ${returnTripName ?? "trip"} assets`}');
  expect(knowledgeWorkspace).toContain('{returnTripName ?? "Trip"}</Text><ChevronRightIcon size="sm" />');
  expect(normalize(galleryWorkspace)).toContain(normalize('{returnTripName ?? "Trip"}</Text><ChevronRightIcon size="sm" />'));
  expect(appSwitcher).not.toContain("onBack?: () => void");
  expect(appSwitcher).toContain('trigger === "back"');
  expect(appSwitcher).toContain('onPress={() => setOpen(true)}');
  expect(workspace).toContain('assetTabs: { flexDirection: "row", gap: 4, padding: 3');
  expect(workspace).toContain("assetTab: { flex: 1, height: 28, minHeight: 28");
  expect(workspace).toContain('textStyle={styles.assetTabText}');
  expect(workspace).toContain("assetTabText: { fontSize: 10, letterSpacing: 0.8, lineHeight: 12 }");
  expect(workspace).toContain("Math.floor(((assetGridWidth || fallbackGridWidth) - GRID_GAP * 2) / 3)");
});

test("refreshes trips when attached assets or custom covers are deleted", () => {
  expect(galleryWorkspace).toContain("const invalidateCompassTrips = () => queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(galleryContext), exact: true })");
  expect(knowledgeWorkspace).toContain("queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(contentContext), exact: true })");
  expect(eventBridge).toContain("invalidateCompassTrips();");
});

test("guards shared asset cache reads across close and reopen", () => {
  expect(workspace).toContain("const generation = ++assetsGeneration.current");
  expect(workspace).toContain("generation !== assetsGeneration.current");
  expect(workspace).toContain("function closeAssets()");
  expect(workspace).toContain("assetsGeneration.current += 1");
  expect(workspace).toContain("setAssetsLoading(false)");
});

test("uses delayed sibling sheet transitions while allowing nested viewers", () => {
  expect(workspace).toContain("export const SHEET_TRANSITION_DELAY_MS = 230");
  expect(workspace).toContain("setTimeout(() =>");
  expect(workspace).toContain("}, SHEET_TRANSITION_DELAY_MS)");
  expect(workspace).toContain("delaySheetTransition(() => setTripOrderOpen(true))");
  expect(workspace).toContain("delaySheetTransition(() => setTripEditOpen(true))");
  expect(workspace).toContain("delaySheetTransition(() => setTripDeleteOpen(true))");
  expect(workspace).not.toContain("requestAnimationFrame(() => setTripOrderOpen(true))");
});

test("longpress accessibility toggles selected items and Find Place reuses the compact root search", () => {
  const orderLongpress = workspace.slice(workspace.indexOf("function handleOrderLongPress"), workspace.indexOf("function removeSelectedOrderPlaces"));
  const detailLongpress = workspace.slice(workspace.indexOf("function handleTripPlaceLongPress"), workspace.indexOf("function handleTripPlacePress"));
  expect(orderLongpress).toContain("current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]");
  expect(detailLongpress).toContain("current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]");
  expect(workspace).toContain('style={styles.workspaceSearchInput}');
  expect(workspace).toContain("styles.sheetSearchClear");
  expect(workspace).not.toContain("setTimeout(() => placeSearchInput.current?.focus(), 300)");
  expect(workspace).toContain('focusKey="findPlace"');
  expect(workspace).toContain("ref={placeSearchInput}");
});

test("uses shared controls only and md buttons throughout sheets", () => {
  expect(workspace).toContain('from "@vorinthex/shared/ui/button"');
  expect(workspace).toContain('from "@vorinthex/shared/ui/bottom-sheet"');
  expect(workspace).toContain('from "@vorinthex/shared/ui/tabs"');
  expect(workspace).not.toContain("<Pressable");
  expect(workspace).not.toContain("<Touchable");
  expect(workspace).not.toContain("<button");
  expect(workspace).not.toContain("<Button loading={trip");
});

test("finds places in a stacked full-screen parent with exact debounce and skeletons", () => {
  expect(workspace).toContain("export const PLACE_SEARCH_DEBOUNCE_MS = 300");
  expect(workspace).toContain('placeholder="Search any country or city..."');
  expect(workspace).toContain("const generation = ++placeSearchGeneration.current");
  expect(workspace).toContain("findPlaces(query, controller.signal)");
  expect(workspace).toContain("clearTimeout(timer); controller.abort()");
  expect(workspace).toContain("if (!createPlaceOpen || query.length < 2)");
  expect(workspace).toContain("setPlaceSearchLoading(value.trim().length >= 2)");
  expect(workspace).toContain("Array.from({ length: 3 }");
  expect(workspace).toContain('cityPillSkeleton: { width: "100%", height: 44, borderRadius: 999 }');
  expect(workspace).toContain('open={createPlaceOpen} title="Find place"');
  expect(workspace).not.toContain("result.country} · {result.countryCode");
  expect(workspace).toContain("setCountryDetailOpen(true)");
  expect(workspace).toContain("setCityDetailOpen(true)");
});

test("uses authoritative search-result context without child generation for create-place countries", () => {
  expect(workspace).toContain("countryCode: result.countryCode, name: result.country, continent: result.continent, latitude: result.lat, longitude: result.long");
  expect(workspace).toContain('if (result.kind === "country")');
  expect(workspace).toContain('else openCityDetail({ name: result.name, latitude: result.lat, longitude: result.long }');
  expect(workspace).toContain('enabled: countryDetailEnabled && detailSource === "globe" && Boolean(childrenRequestToken)');
  expect(workspace).toContain('detailSource === "globe" ?');
  expect(workspace).not.toContain("findPlaceChildren(result");
});

test("limits country child cities to root globe exploration", () => {
  const savedPlaceDetail = workspace.slice(workspace.indexOf('accessibilityLabel={`${selectedPlace.name} place details`}'), workspace.indexOf('tripDetailTab === "images"'));
  expect(savedPlaceDetail).not.toContain("popularCities.map");
  expect(workspace).toContain('<View style={[styles.cityList, styles.countryCityList]}>');
  expect(workspace).toContain('countryDetail: { gap: spacing.md, paddingTop: spacing.md }');
  expect(workspace).toContain('countryCityList: { paddingBottom: 0 }');
});

test("stacks independent full-height country and city detail sheets", () => {
  const countrySheet = workspace.indexOf('height="full" onOpenChange={setCountryDetailOpen} open={countryDetailOpen} title={selectedCountry?.name ?? "Country"}');
  const citySheet = workspace.indexOf('height="full" onOpenChange={setCityDetailOpen} open={cityDetailOpen} title={selectedCity?.name ?? "City"}');
  expect(countrySheet).toBeGreaterThan(-1);
  expect(citySheet).toBeGreaterThan(countrySheet);
  expect(workspace).toContain('onPress={() => setCountryDetailOpen(false)} size="md"');
  expect(workspace).toContain('onPress={() => setCityDetailOpen(false)} size="md"');
  expect(workspace).not.toContain("open={countryDetailOpen || cityDetailOpen}");
  expect(workspace).not.toContain("if (cityDetailOpen) setCityDetailOpen(false); else setCountryDetailOpen(false)");
});

test("matches the Gallery root filter sheet spacing", () => {
  expect(workspace).toContain('filterSheet: { gap: 6 }');
  expect(workspace).toContain('filterSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs }');
  expect(workspace).toContain('filterSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 }');
});

test("hides duplicate and in-flight saves immediately", () => {
  expect(workspace).toContain("countryCode.toLocaleUpperCase() === selectedCountry.countryCode.toLocaleUpperCase()");
  expect(workspace).toContain("normalizePlaceName(name) === normalizePlaceName(selectedCity.name)");
  expect(workspace).toContain('kind === "country" ? `country:${countryCode.toLocaleUpperCase()}`');
  expect(workspace).toContain("pendingPlaceSaveRef.current.add(saveIdentity)");
  expect(workspace).toContain("!countryAlreadySaved && countryDetail ? <Button");
  expect(workspace).toContain("!cityAlreadySaved && cityDetail ? <Button");
  expect(workspace).toContain("setCountryDetailOpen(false)");
  expect(workspace).toContain("setCityDetailOpen(false)");
  expect(workspace).not.toContain("setCreatePlaceOpen(false);\n    showToast");
});

test("uses contextual success toasts for saved countries and cities", () => {
  expect(workspace).toContain('showToast({ title: kind === "country" ? "Country saved" : "City saved"');
  expect(workspace).not.toContain("Saved to my places");
});

test("retains generated guide caching and persisted hero reuse", () => {
  expect(workspace).toContain("savedCountryImage ?? countryImageQuery.data");
  expect(workspace).toContain("savedCityImage ?? cityImageQuery.data");
  expect(workspace).toContain("!savedCountryImage && !countryDetailQuery.isFetching");
  expect(workspace).toContain("!savedCityImage && !cityDetailQuery.isFetching");
  expect(workspace).toContain("findPlaceChildren(countryDetailQuery.data.childrenRequestToken, signal)");
  expect(workspace).toContain("hydratePlaceChildren(queryClient");
  expect(workspace).not.toContain("Promise.allSettled(heroQueries)");
  expect(workspace).toContain('cachePolicy="none"');
  expect(workspace).toContain('key={image?.url ?? "hero"}');
  expect(workspace).not.toContain("removeQueries");
});

test("uses the exact 300ms globe search debounce", () => {
  expect(workspace).toContain("export const COUNTRY_SEARCH_DEBOUNCE_MS = 300");
  expect(workspace).toContain("searchCountries(query, controller.signal)");
  expect(workspace).not.toContain("COUNTRY_SEARCH_DEBOUNCE_MS = 350");
});
