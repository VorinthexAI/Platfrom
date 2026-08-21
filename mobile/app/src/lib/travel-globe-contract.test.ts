import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globe = readFileSync(new URL("../components/three/InteractiveGlobe.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");

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
  expect(workspace).not.toContain("Search history");
  expect(workspace).not.toContain("My Places");
  expect(workspace).not.toContain("Filter Compass");
});

test("renders Places and Trips tabs as exact three-column root grids", () => {
  expect(workspace).toContain('type TableTab = "places" | "trips"');
  expect(workspace).toContain('>Places</Button>');
  expect(workspace).toContain('>Trips</Button>');
  expect(workspace).toContain("Math.floor((tableGridWidth - GRID_GAP * 2) / 3)");
  expect(workspace).toContain("Math.floor((tripGridWidth - GRID_GAP * 2) / 3)");
  expect(workspace).toContain("compassQueryKeys.trips(travelContext)");
  expect(workspace).toContain("listTrips(signal)");
  expect(workspace).toContain("Array.from({ length: 3 }");
  expect(workspace).toContain("trip.coverUrl");
  expect(workspace).toContain("trip.name");
});

test("offers exactly the two new creation actions plus Close", () => {
  const addSheet = workspace.slice(workspace.indexOf('title="Add in Compass"'), workspace.indexOf('title="Create place"'));
  expect(addSheet).toContain(">Create place</BottomSheetItem>");
  expect(addSheet).toContain(">Create trip</BottomSheetItem>");
  expect(addSheet).toContain(">Close</Button>");
  expect(addSheet.match(/<BottomSheetItem/g)).toHaveLength(2);
  expect(addSheet).toContain('style={styles.sheetAction} variant="secondary"');
  expect(addSheet).not.toContain("icon={");
  expect(addSheet).not.toContain("Browse");
});

test("creates trips in two full-screen steps with ordered optimistic reconciliation", () => {
  expect(workspace).toContain('open={tripSelectionOpen} title="Choose places"');
  expect(workspace).toContain('open={tripDetailsOpen} title="Create trip"');
  expect(workspace).toContain("selectedPlaceKeys.length === 0");
  expect(workspace).toContain("current.length < 100 ? [...current, key]");
  expect(workspace).toContain('disabled ? "Saving" : selectable ? selected ? "Deselect" : "Select" : "Open"');
  expect(workspace).toContain('place={place} selectable selected={selectedPlaceKeys.includes(place.key)}');
  expect(workspace).toContain('disabled={saving}');
  expect(workspace).toContain('key.startsWith("optimistic-")');
  expect(workspace).toContain("selected && styles.squareCardSelected");
  expect(workspace).toContain('<CheckIcon size="sm" variant="inverse" />');
  expect(workspace).toContain('maxLength={255}');
  expect(workspace).toContain('Description (Optional)');
  expect(workspace).toContain('maxLength={10000} multiline');
  expect(workspace).toContain('placeholder="What belongs in this trip?"');
  expect(workspace).toContain("tripDescriptionInput: { minHeight: 120 }");
  expect(workspace).toContain("selectedPlaceKeys.map((key)");
  expect(workspace).toContain("cancelQueries({ queryKey: tripsKey, exact: true })");
  expect(workspace).toContain("appendOptimisticCompassTrip(current, optimisticTrip)");
  expect(workspace).toContain("reconcileOptimisticCompassTrip(current, optimisticKey, trip)");
  expect(workspace).toContain("removeOptimisticCompassTrip(current, optimisticKey)");
  expect(workspace).not.toContain("previousTrips");
});

test("searches for places in a stacked full-screen parent with exact debounce and skeletons", () => {
  expect(workspace).toContain("export const PLACE_SEARCH_DEBOUNCE_MS = 300");
  expect(workspace).toContain('placeholder="Search any country or city"');
  expect(workspace).toContain("const generation = ++placeSearchGeneration.current");
  expect(workspace).toContain("searchPlaces(query, controller.signal)");
  expect(workspace).toContain("clearTimeout(timer); controller.abort()");
  expect(workspace).toContain("if (query.length < 2)");
  expect(workspace).toContain("setPlaceSearchLoading(value.trim().length >= 2)");
  expect(workspace).toContain("Array.from({ length: 3 }");
  expect(workspace).toContain("cityPillSkeleton: { width: \"100%\", height: 44");
  expect(workspace).toContain('open={createPlaceOpen} title="Create place"');
  expect(workspace).toContain("setCountryDetailOpen(true)");
  expect(workspace).toContain("setCityDetailOpen(true)");
});

test("uses authoritative search-result context without child generation for create-place countries", () => {
  expect(workspace).toContain("countryCode: result.countryCode, name: result.country, continent: result.continent, latitude: result.lat, longitude: result.long");
  expect(workspace).toContain('if (result.kind === "country")');
  expect(workspace).toContain('else openCityDetail({ name: result.name, latitude: result.lat, longitude: result.long }');
  expect(workspace).toContain('enabled: countryDetailEnabled && detailSource !== "createPlace" && Boolean(childrenRequestToken)');
  expect(workspace).toContain('detailSource !== "createPlace" ?');
  expect(workspace).not.toContain("findPlaceChildren(result");
});

test("matches duplicate saves by normalized name and country code", () => {
  expect(workspace).toContain("countryCode.toLocaleUpperCase() === selectedCountry.countryCode.toLocaleUpperCase()");
  expect(workspace).toContain("normalizePlaceName(name) === normalizePlaceName(selectedCountry.name)");
  expect(workspace).toContain("normalizePlaceName(name) === normalizePlaceName(selectedCity.name)");
  expect(workspace).toContain("!savedCountryDetail ? <Button");
  expect(workspace).toContain("!savedCityDetail ? <Button");
  expect(workspace).toContain("setCountryDetailOpen(false)");
  expect(workspace).toContain("setCityDetailOpen(false)");
  expect(workspace).not.toContain("setCreatePlaceOpen(false);\n    showToast");
});

test("retains generated guide caching and persisted hero reuse", () => {
  expect(workspace).toContain("savedCountryImage ?? countryImageQuery.data");
  expect(workspace).toContain("savedCityImage ?? cityImageQuery.data");
  expect(workspace).toContain("!savedCountryImage && !countryDetailQuery.isFetching");
  expect(workspace).toContain("!savedCityImage && !cityDetailQuery.isFetching");
  expect(workspace).toContain("findPlaceChildren(countryDetailQuery.data.childrenRequestToken, signal)");
  expect(workspace).toContain("hydratePlaceChildren(queryClient");
  expect(workspace).toContain('cachePolicy="none"');
  expect(workspace).toContain('key={image?.url ?? "hero"}');
  expect(workspace).not.toContain("removeQueries");
});

test("uses the exact 300ms globe search debounce", () => {
  expect(workspace).toContain("export const COUNTRY_SEARCH_DEBOUNCE_MS = 300");
  expect(workspace).toContain("searchCountries(query, controller.signal)");
  expect(workspace).not.toContain("COUNTRY_SEARCH_DEBOUNCE_MS = 350");
});
