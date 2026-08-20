import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globe = readFileSync(new URL("../components/three/InteractiveGlobe.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");

test("renders Natural Earth country boundaries on the interactive Three.js globe", () => {
  expect(globe).toContain("createCountryBoundaryGeometry");
  expect(globe).toContain("createCountryFillGeometry");
  expect(globe).toContain('color="#a9bac2" side={THREE.DoubleSide}');
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
  expect(workspace).toContain('label="CULTURE"');
  expect(workspace).toContain('label="FOOD"');
  expect(workspace).toContain('label="WHY VISIT"');
  expect(workspace).toContain("POPULAR CITIES");
  expect(workspace).toContain("Image unavailable");
  expect(workspace).not.toContain("IMAGE SOURCES");
  expect(workspace).not.toContain("AI-generated interpretation based on researched destination context");
  expect(workspace).toContain("name: countryDetail.location.name");
  expect(workspace).not.toContain("supportingMedia");
  expect(workspace).not.toContain(">Try again</Button>");
});

test("caches token-dependent country sheets for exactly one hour without polling or clearing", () => {
  expect(workspace).toContain("export const COUNTRY_SHEET_CACHE_MS = 60 * 60_000");
  expect(workspace.match(/staleTime: COUNTRY_SHEET_CACHE_MS/g)).toHaveLength(4);
  expect(workspace.match(/gcTime: COUNTRY_SHEET_CACHE_MS/g)).toHaveLength(4);
  expect(workspace).toContain("compassQueryKeys.countryDetail(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("compassQueryKeys.countryImage(travelContext, countryDetailQuery.data?.imageRequestToken");
  expect(workspace).toContain("enabled: countryDetailEnabled && !countryDetailQuery.isFetching");
  expect(workspace).toContain("retry: false");
  expect(workspace).toContain("countryDetailQuery.isError || countryImageQuery.isError");
  expect(workspace).toContain("compassQueryKeys.cityDetail(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("compassQueryKeys.cityImage(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("return findCity(selectedCity.name, countryInput(selectedCountry), signal)");
  expect(workspace).toContain("open={citySheetOpen}");
  expect(workspace).toContain("setCitySheetOpen(false)");
  expect(workspace).toContain("Keep an already-paid image request alive");
  expect(workspace).toContain("queryFn: ({ signal })");
  expect(workspace).not.toContain("POLL");
  expect(workspace).not.toContain("setTimeout");
  expect(workspace).not.toContain("removeQueries");
  expect(workspace).not.toContain("setCountryImages");
  expect(workspace).not.toContain("countryDetailRequest");
});

test("uses shared Compass chrome, save footers, and a composer accessory island", () => {
  expect(workspace).toContain('trigger="back"');
  expect(workspace).toContain('accessibilityLabel="Search Compass places"');
  expect(workspace).toContain('accessibilityLabel="Filter Compass"');
  expect(workspace).toContain('accessibilityLabel="Add in Compass"');
  expect(workspace).toContain("accessory={selectedCountry");
  expect(workspace).toContain('title: "Country saved to my places"');
  expect(workspace).toContain('title: "City saved to my places"');
  expect(workspace).toContain("void createPlace(input).then(cachePlace)");
  expect(workspace).not.toContain("loading={countrySaving}");
  expect(workspace).not.toContain("loading={citySaving}");
  expect(workspace).toContain("countryScrollRef.current?.scrollTo({ y: 0");
});
