import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globe = readFileSync(new URL("../components/three/InteractiveGlobe.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url), "utf8");

test("renders Natural Earth country boundaries on the interactive Three.js globe", () => {
  expect(globe).toContain("createCountryBoundaryGeometry");
  expect(globe).toContain("findCountryAtCoordinates");
  expect(globe).toContain("projectToTrackball");
  expect(globe).toContain("useFrame");
  expect(globe).toContain("onWheel");
  expect(globe).toContain("gesture.pointers.size > 1");
  expect(globe).not.toContain("earth-textures");
});

test("opens a full country detail sheet while place.find loads", () => {
  expect(workspace).toContain('activeSheet === "countryDetail"');
  expect(workspace).toContain('activeSheet === "countryDetail" ? selectedCountry?.name ?? "Country"');
  expect(workspace).toContain("countryDetailLoading");
  expect(workspace).toContain("<Skeleton");
  expect(workspace).toContain("return findPlace(");
  expect(workspace).toContain("onCountryPress=");
  expect(workspace).toContain("selectedCountryCode=");
  expect(workspace).not.toContain("{countryDetail.title}");
  expect(workspace).not.toContain(">Try again</Button>");
});

test("loads a one-plus-three portrait media set independently from country text", () => {
  expect(workspace).toContain('import { Image } from "expo-image"');
  expect(workspace).toContain("const countryDetailQuery = useQuery");
  expect(workspace).toContain("const countryImagesQuery = useQuery");
  expect(workspace).toContain("countryDetailQuery.data?.imageRequestToken");
  expect(workspace).toContain("imageRequestToken: countryDetailQuery.data.imageRequestToken");
  expect(workspace).toContain("countryImages?.images[0]");
  expect(workspace).toContain("[0, 1, 2].map");
  expect(workspace).toContain("aspectRatio: 9 / 16");
  expect(workspace).toContain('width: "100%"');
  expect(workspace).toContain("loadState !== \"loaded\" ? <Skeleton");
  expect(workspace).toContain('onLoad={() => setLoadState("loaded")}');
  expect(workspace).toContain('onError={() => setLoadState("error")}');
  expect(workspace).toContain('useEffect(() => setLoadState("loading"), [image?.url])');
  expect(workspace).toContain("AI-generated interpretation");
  expect(workspace).toContain("Image unavailable");
  expect(workspace).toContain("heroImageFrameWide");
  expect(workspace).not.toContain(">Try again</Button>");
});

test("caches token-dependent country sheets for exactly one hour without polling or clearing", () => {
  expect(workspace).toContain("export const COUNTRY_SHEET_CACHE_MS = 60 * 60_000");
  expect(workspace.match(/staleTime: COUNTRY_SHEET_CACHE_MS/g)).toHaveLength(2);
  expect(workspace.match(/gcTime: COUNTRY_SHEET_CACHE_MS/g)).toHaveLength(2);
  expect(workspace).toContain("compassQueryKeys.countryDetail(travelContext, selectedCountry?.countryCode");
  expect(workspace).toContain("compassQueryKeys.countryImages(travelContext, countryDetailQuery.data?.imageRequestToken");
  expect(workspace).toContain("enabled: countryDetailEnabled && !countryDetailQuery.isFetching");
  expect(workspace).toContain("retry: false");
  expect(workspace).toContain("countryDetailQuery.isError || countryImagesQuery.isError");
  expect(workspace).toContain("Keep an already-paid image request alive");
  expect(workspace).toContain("queryFn: ({ signal })");
  expect(workspace).not.toContain("POLL");
  expect(workspace).not.toContain("setTimeout");
  expect(workspace).not.toContain("removeQueries");
  expect(workspace).not.toContain("setCountryImages");
  expect(workspace).not.toContain("countryDetailRequest");
});
