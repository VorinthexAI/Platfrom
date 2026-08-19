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
  expect(workspace).toContain("countryDetailLoading");
  expect(workspace).toContain("<Skeleton");
  expect(workspace).toContain("await findPlace(");
  expect(workspace).toContain("onCountryPress=");
  expect(workspace).toContain("selectedCountryCode=");
});
