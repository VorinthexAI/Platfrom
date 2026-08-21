import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../components/capability/${name}`, import.meta.url), "utf8");

test("uses exact-size shared circular icon buttons for every workspace search clear control", () => {
  const archive = read("KnowledgeWorkspace.tsx");
  const gallery = read("GalleryWorkspace.tsx");
  const travel = read("TravelWorkspace.tsx");
  expect(archive.match(/accessibilityLabel="Clear (?:Archive search|folder search|document search|Archive folder picker search|Archive document picker search)"[^\n]*variant="icon"/g)).toHaveLength(5);
  expect(gallery.match(/accessibilityLabel="Clear image search"[^\n]*variant="icon"/g)).toHaveLength(2);
  expect(travel.match(/accessibilityLabel="Clear Compass search"[^\n]*variant="icon"/g)).toHaveLength(1);
  expect(`${archive}${gallery}${travel}`).not.toContain("clearSearchButton:");
  expect(archive.match(/accessibilityLabel="Clear Archive (?:folder|document) picker search"[^\n]*size="md"/g)).toHaveLength(2);
  expect(gallery).toMatch(/accessibilityLabel="Clear image search"[^\n]*onPress=\{\(\) => updateIdentityPickerSearch\(""\)\}[^\n]*size="md"/);
});
