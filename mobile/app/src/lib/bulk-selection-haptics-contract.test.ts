import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readCapability = (name: string) => readFileSync(new URL(`../components/capability/${name}.tsx`, import.meta.url), "utf8");
const archive = readCapability("KnowledgeWorkspace");
const gallery = [readCapability("GalleryWorkspace"), readCapability("GalleryHighlights"), readCapability("GalleryMemories")].join("\n");
const signal = [readCapability("SignalWorkspace"), readCapability("EmailWorkspace")].join("\n");
const compass = readCapability("TravelWorkspace");
const ascend = readCapability("AscendWorkspace");
const core = readFileSync(new URL("../components/PersistentCoreComposer.tsx", import.meta.url), "utf8");

function guardedHapticCount(source: string) {
  return source.match(/if \([^\n]*(?:enteringSelection|selectedCount === 0)[^\n]*\) void Haptics\.selectionAsync\(\);/g)?.length ?? 0;
}

function hapticCount(source: string) {
  return source.match(/void Haptics\.selectionAsync\(\);/g)?.length ?? 0;
}

test("bulk selection vibrates only when the first item enters selection mode", () => {
  expect(guardedHapticCount(archive)).toBe(2);
  expect(guardedHapticCount(gallery)).toBe(3);
  expect(guardedHapticCount(signal)).toBe(5);
  expect(guardedHapticCount(compass)).toBe(5);
  expect(guardedHapticCount(ascend)).toBe(1);
  expect(guardedHapticCount(core)).toBe(1);
  expect([archive, gallery, signal, compass, ascend].map(hapticCount)).toEqual([2, 3, 5, 5, 1]);
});
