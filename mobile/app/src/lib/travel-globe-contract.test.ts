import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globe = readFileSync(new URL("../components/three/InteractiveGlobe.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");

test("renders Natural Earth country boundaries on the interactive Three.js globe", () => {
  expect(globe).toContain("createCountryBoundaryGeometry");
  expect(globe).toContain("createCountryFillGeometry");
  expect(globe).toContain('color="#a9bac2" depthWrite={false} side={THREE.DoubleSide}');
  expect(globe).toContain("findCountryAtCoordinates");
  expect(globe).toContain("projectToTrackball");
  expect(globe).toContain("useFrame");
  expect(globe).toContain("onWheel");
  expect(globe).toContain("gesture.pointers.size > 1");
  expect(globe).toContain("const MAX_CAMERA_DISTANCE = 5.2");
  expect(globe).toContain('frameloop="demand"');
  expect(globe).toContain('antialias: Platform.OS !== "android"');
  expect(globe.match(/raycast={disableRaycast}/g)?.length).toBeGreaterThanOrEqual(4);
  expect(globe).toContain("args={[GLOBE_RADIUS, 24, 16]}");
  expect(globe).not.toContain('frameloop="always"');
  expect(globe).not.toContain("earth-textures");
  expect(globe).toContain("AUTO_ROTATION_RADIANS_PER_SECOND * delta");
  expect(globe).toContain("Math.exp(-INERTIA_DAMPING * delta)");
  expect(globe).toContain('dpr={Platform.OS === "android" ? 1 : [1, 2]}');
  expect(globe).toContain("idle && !reducedMotion");
  expect(globe).toContain("[1.03, 1.034, 1.038]");
  expect(globe).toContain("pulseElapsed >= FOCUS_PULSE_DURATION_MS");
  expect(globe).toContain("focusFill");
  expect(globe.match(/depthWrite={false} side={THREE.DoubleSide}/g)?.length).toBe(2);
  expect(globe).toContain("selectedCountryCode !== highlightedCountryCode");
});

test("opens a full country detail sheet while place.find loads", () => {
  expect(workspace).toContain('sheetView === "countryDetail"');
  expect(workspace).toContain('sheetView === "countryDetail" ? selectedCountry?.name ?? "Country"');
  expect(workspace).toContain("countryDetailLoading");
  expect(workspace).toContain("<Skeleton");
  expect(workspace).toContain("return findPlace(");
  expect(workspace).toContain("onCountryPress=");
  expect(workspace).toContain("selectedCountryCode=");
  expect(workspace).not.toContain("{countryDetail.title}");
  expect(workspace).not.toContain(">Try again</Button>");
});

test("loads one generated landscape hero independently from country text", () => {
  expect(workspace).toContain('import { Image } from "expo-image"');
  expect(workspace).toContain("const countryDetailQuery = useQuery");
  expect(workspace).toContain("const countryImageQuery = useQuery");
  expect(workspace).toContain("countryDetailQuery.data?.imageRequestToken");
  expect(workspace).toContain("imageRequestToken: countryDetailQuery.data.imageRequestToken");
  expect(workspace).toContain("countryImage?.image");
  expect(workspace).toContain("aspectRatio: 1.15");
  expect(workspace).toContain('width: "100%"');
  expect(workspace).toContain("loadState !== \"loaded\" ? <Skeleton");
  expect(workspace).toContain('onLoad={() => setLoadState("loaded")}');
  expect(workspace).toContain('onError={() => setLoadState("error")}');
  expect(workspace).toContain('key={image?.url ?? "hero"}');
  expect(workspace).toContain('cachePolicy="none"');
  expect(workspace).toContain('const sections = [["summary", detail.summary], ["culture", detail.culture], ["food", detail.food], ["whyVisit", detail.whyVisit]]');
  expect(workspace).toContain("styles.guideSections");
  expect(workspace).toContain("sections.map(([key, section])");
  expect(workspace).not.toContain("heroText");
  expect(workspace).not.toContain("TravelRecommendationSection");
  expect(workspace).toContain(">Popular cities</Text>");
  expect(workspace).toContain("Image unavailable");
  expect(workspace).not.toContain("IMAGE SOURCES");
  expect(workspace).not.toContain("AI-generated interpretation based on researched destination context");
  expect(workspace).toContain("name: countryDetail.location.name");
  expect(workspace).not.toContain("supportingMedia");
  expect(workspace).not.toContain(">Try again</Button>");
});

test("keeps durable country and child details cached without polling or clearing", () => {
  expect(workspace).toContain("export const COUNTRY_SHEET_CACHE_MS = PLACE_GUIDE_CACHE_MS");
  expect(workspace.match(/staleTime: COUNTRY_SHEET_CACHE_MS/g)).toHaveLength(5);
  expect(workspace.match(/gcTime: COUNTRY_SHEET_CACHE_MS/g)).toHaveLength(5);
  expect(workspace).toContain("compassQueryKeys.countryDetail(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("compassQueryKeys.countryImage(travelContext, countryDetailQuery.data?.imageRequestToken");
  expect(workspace).toContain("enabled: countryDetailEnabled && !countryDetailQuery.isFetching");
  expect(workspace).toContain("retry: false");
  expect(workspace).toContain("countryDetailQuery.isError || countryImageQuery.isError");
  expect(workspace).toContain("compassQueryKeys.cityDetail(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("compassQueryKeys.cityImage(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("compassQueryKeys.placeChildren(travelContext, childrenRequestToken)");
  expect(workspace).toContain("findPlaceChildren(countryDetailQuery.data.childrenRequestToken, signal)");
  expect(workspace).toContain("hydratePlaceChildren(queryClient, travelContext, selectedCountry.countryCode");
  expect(workspace).toContain("void Promise.allSettled(heroQueries)");
  expect(workspace).toContain("refetchInterval: false");
  expect(workspace).toContain("open={citySheetOpen}");
  expect(workspace).toContain("open={sheetOpen}");
  expect(workspace).toContain("return findCity(selectedCity.name");
  expect(workspace).toContain("setCitySheetOpen(false)");
  expect(workspace).toContain("Keep an already-paid image request alive");
  expect(workspace).toContain("queryFn: ({ signal })");
  expect(workspace).not.toContain("POLL");
  expect(workspace).toContain("searchFocusReleaseTimer.current = setTimeout");
  expect(workspace).not.toContain("removeQueries");
  expect(workspace).not.toContain("setCountryImages");
  expect(workspace).not.toContain("countryDetailRequest");
});

test("uses shared Compass chrome, save footers, and a composer accessory island", () => {
  expect(workspace).toContain('trigger="back"');
  expect(workspace).toContain('accessibilityLabel="Search Compass countries"');
  expect(workspace).toContain('accessibilityLabel="Filter Compass"');
  expect(workspace).toContain('accessibilityLabel="Add in Compass"');
  expect(workspace).toContain("accessory={selectedCountry");
  expect(workspace).toContain('title: "Country saved to my places"');
  expect(workspace).toContain('title: "City saved to my places"');
  expect(workspace).toContain("void persistGeneratedPlace(input, optimisticKey");
  expect(workspace).toContain("summary: countryDetail.summary");
  expect(workspace).toContain("imageRequestToken: countryDetail.imageRequestToken");
  expect(workspace).toContain('countryImage?.status !== "ready"');
  expect(workspace).toContain('cityImage?.status !== "ready"');
  expect(workspace).not.toContain("loading={countrySaving}");
  expect(workspace).not.toContain("loading={citySaving}");
  expect(workspace).toContain("countryScrollRef.current?.scrollTo({ y: 0");
  expect(workspace).toContain('contentMode="raw" onPress={() => openCountryDetail(selectedCountry)} size="sm"');
  expect(workspace).toContain('<LoadingText text="Generating image..." />');
  expect(workspace).toContain('text="Generating country guide..."');
  expect(workspace).toContain('text="Generating city guide..."');
  expect(workspace).toContain("cityDetailQuery.isPending || cityDetailQuery.isFetching");
  expect(workspace).toMatch(/function openCityDetail[\s\S]*setCitySheetOpen\(true\);[\s\S]*setSheetOpen\(false\);/);
  expect(workspace).toContain('sheetFooter: { width: "100%", gap: spacing.sm');
});

test("debounces canonical country search, aborts stale requests, and focuses without opening detail", () => {
  expect(workspace).toContain("export const COUNTRY_SEARCH_DEBOUNCE_MS = 350");
  expect(workspace).toContain("const controller = new AbortController()");
  expect(workspace).toContain("return () => { clearTimeout(timer); controller.abort(); }");
  expect(workspace).toContain("void searchCountries(query, controller.signal)");
  expect(workspace).toContain("setSearchFocus(undefined)");
  expect(workspace).toContain("focusTarget={searchFocus ?? undefined}");
  const searchInput = workspace.slice(workspace.indexOf('accessibilityLabel="Search Compass countries"'), workspace.indexOf('accessibilityLabel="Filter Compass"'));
  expect(searchInput).not.toContain("openBrowse");
  expect(searchInput).not.toContain("openCountryDetail");
  expect(workspace).toContain("Browse countries and saved places");
});

test("animates a bounded controlled focus pulse without saved-place map pins", () => {
  expect(globe).toContain("focusTarget?: Readonly");
  expect(globe).toContain("FOCUS_DURATION_MS = 700");
  expect(globe).toContain("FOCUS_PULSE_DURATION_MS = 2_600");
  expect(globe).toContain("setFromUnitVectors");
  expect(globe).toContain("globe.quaternion.copy(focus.from).slerp");
  expect(globe).toContain("THREE.MathUtils.lerp(focus.fromDistance, MIN_CAMERA_DISTANCE, easedProgress)");
  expect(globe).toContain("focusAnimation.current = undefined");
  expect(globe).toContain("pulseElapsed < FOCUS_PULSE_DURATION_MS");
  expect(globe).toContain("focusAnimation.current || pulseElapsed < FOCUS_PULSE_DURATION_MS || idle && !reducedMotion");
  expect(globe).not.toContain("PlaceMarker");
  expect(globe).not.toContain("GlobePlace");
  expect(workspace).not.toContain("places={globePlaces}");
  expect(workspace).not.toContain("onPlacePress=");
});

test("uses backend coordinates for search focus while pulsing only mapped local geometry", () => {
  expect(workspace).toContain("setSearchFocus(match)");
  expect(workspace).toContain("focusTarget={searchFocus ?? undefined}");
  expect(globe).toContain("const point = latLonToVector(focusLatitude, focusLongitude)");
  expect(globe).toContain("properties.countryCode === highlightedCountryCode");
  expect(globe).toContain("createCountryBoundaryGeometry({ type: \"FeatureCollection\", features: [country] }, radius)");
});

test("scopes concurrent optimistic save reconciliation and invalidates managed Gallery caches", () => {
  expect(workspace).toContain("await queryClient.cancelQueries({ queryKey: overviewKey, exact: true }).catch(() => undefined)");
  expect(workspace).toContain("addOptimisticCompassPlace(current");
  expect(workspace).toContain("reconcileOptimisticCompassPlace(current, optimisticKey, place)");
  expect(workspace).toContain("removeOptimisticCompassPlace(current, optimisticKey)");
  expect(workspace).not.toContain("setQueryData(compassQueryKeys.overview(travelContext), previous)");
  expect(workspace).toContain("invalidateQueries({ queryKey: galleryQueryKeys.all(travelContext) })");
});

test("shares global search history and records country and city opens including cached details", () => {
  expect(workspace).toContain('title="Search history"');
  expect(workspace).toContain("<SearchHistoryPill");
  expect(workspace).toContain("getContentHistory(queryClient, contentContext, undefined)");
  expect(workspace).toContain("promoteCachedContentHistory(queryClient, contentContext, undefined, item)");
  expect(workspace).toContain("removeCachedContentHistory(queryClient, contentContext, undefined, item.normalizedQuery)");
  expect(workspace).toContain("deleteContentSearchHistory(item.normalizedQuery)");
  expect(workspace).toContain("recordedCountryOpen.current === countryOpenRequest");
  expect(workspace).toContain("recordedCityOpen.current === cityOpenRequest");
  expect(workspace.match(/void openPlace\(/g)).toHaveLength(2);
});

test("opens an exact full-screen Recent places sheet with distinct globe behavior", () => {
  expect(workspace).toContain('accessibilityLabel="Recent places"');
  expect(workspace).toContain('height="full" onOpenChange={setRecentOpen} open={recentOpen} title="Recent places"');
  expect(workspace).not.toContain('title="Recent places" description=');
  expect(workspace).toContain("recentPlaces.slice(0, 25)");
  expect(workspace).toContain('if (place.kind === "country")');
  expect(workspace).toContain("openCountryDetail(country, true)");
  expect(workspace).toContain("setSearchFocus(undefined)");
  expect(workspace).toContain("setHighlightSelectedCountry(false)");
  expect(workspace).toContain("selectedCountryCode={highlightSelectedCountry ? selectedCountry?.countryCode : undefined}");
  expect(workspace).toContain("openCityDetail({ name: place.name");
});
