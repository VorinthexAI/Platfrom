import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = readFileSync(join(import.meta.dir, "../components/capability/AscendWorkspace.tsx"), "utf8");
const bridge = readFileSync(join(import.meta.dir, "event-bridge.tsx"), "utf8");
const playback = readFileSync(join(import.meta.dir, "book-playback.tsx"), "utf8");
const miniPlayer = readFileSync(join(import.meta.dir, "../components/BookMiniPlayer.tsx"), "utf8");
const layout = readFileSync(join(import.meta.dir, "../app/_layout.tsx"), "utf8");

test("uses the standard shell and exact phone book geometry", () => {
  expect(workspace).toMatch(/<WorkspaceAppSwitcher\s+active="ascend"/);
  expect(workspace).toMatch(/<Text style=\{styles\.localTitle\}>Ascend<\/Text>/);
  expect(workspace).toContain("const COLUMNS = 3");
  expect(workspace).toContain("const GRID_GAP = 8");
  expect(workspace).toContain("height: (cardWidth * 16) / 9");
  expect(workspace).toContain("Array.from({ length: COLUMNS }");
  expect(workspace).toContain("contentMode=\"raw\"");
  expect(workspace).toContain("<CoreComposer");
});

test("keeps source selection explicit and generation asynchronous", () => {
  expect(workspace).toContain("No Archive document is selected automatically.");
  expect(workspace).toContain("archiveDocumentKeys: []");
  expect(workspace).toContain("setSheetOpen(false)");
  expect(workspace.indexOf("setSheetOpen(false)")).toBeLessThan(workspace.indexOf("createMutation.mutate"));
  expect(workspace).toContain('chapterCount: 25');
  expect(workspace).toContain('Short · 10 chapters');
  expect(workspace).toContain('Standard · 25 chapters');
  expect(workspace).toContain('Deep · 50 chapters');
  expect(workspace).not.toContain('lengthMinutes');
  expect(workspace).toContain('getContentLocation(queryClient, contentContext, archiveFolderKey)');
  expect(workspace).toMatch(/searchContentMatches\(\s*documentQuery\.trim\(\),\s*signal/);
  expect(workspace).toContain("const MAX_SOURCE_DOCUMENTS = 50");
  expect(workspace).toContain("draft.archiveDocumentKeys.length >= MAX_SOURCE_DOCUMENTS");
  for (const status of ["queued", "researching", "planning", "writing", "narrating", "finalizing", "failed", "ready"]) expect(workspace).toContain(`\"${status}\"`);
});

test("provides detail, synchronized reading, and lifecycle controls", () => {
  expect(workspace).toContain("height: (chapterWidth * 16) / 9");
  expect(workspace).toMatch(/<Slider\s+accessibilityLabel="Chapter position"/);
  expect(playback).toContain("audio.didJustFinish");
  expect(playback).toContain("setActiveForLockScreen");
  expect(playback).toContain("refreshUrl");
  expect(playback).toContain("const player = useAudioPlayer(null");
  expect(playback.match(/useAudioPlayer\(/g)).toHaveLength(1);
  expect(miniPlayer).toContain('accessibilityLabel="Open full reader"');
  expect(layout).toContain("<BookPlaybackProvider>");
  expect(layout).toContain("<BookMiniPlayer />");
  expect(playback).toContain("beginReplacement(id, request, audio.isLoaded)");
  expect(playback).toContain("const request = ++playbackRequest.current");
  expect(playback).toContain("request !== playbackRequest.current");
  const unmountCleanup = playback.slice(playback.indexOf("useEffect(() => () => {\n    playbackRequest.current += 1"), playback.indexOf("\n\n  const value"));
  expect(unmountCleanup).not.toContain("player.pause()");
  expect(unmountCleanup).not.toContain("player.clearLockScreenControls()");
  expect(workspace).toContain("pageKey={sheet}");
  expect(workspace).toContain("if (!next) setSheet(undefined)");
  expect(workspace).toMatch(/accessibilityValue=\{\{\s*min: 0,\s*max: 100/);
  expect(workspace).toContain("Retry generation");
  expect(workspace).toContain("Cancel generation");
  expect(workspace).toContain("Delete book");
  expect(workspace).toContain('accessibilityLabel="Back to book creation"');
  expect(workspace).toContain("Done · {draft.archiveDocumentKeys.length} selected");
  expect(bridge).toContain('event.event === "book.changed"');
  expect(bridge).toContain("invalidateBooks()");
});
