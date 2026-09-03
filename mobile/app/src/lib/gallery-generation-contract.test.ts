import { expect, test } from "bun:test";

const workspace = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
const composer = await Bun.file(new URL("../components/capability/GalleryImageGeneration.tsx", import.meta.url)).text();
const history = await Bun.file(new URL("../components/capability/GalleryGenerationHistory.tsx", import.meta.url)).text();
const picker = await Bun.file(new URL("../components/capability/EmailAttachmentPicker.tsx", import.meta.url)).text();
const editorMobile = await Bun.file(new URL("../../../../shared/packages/ui/components/ai-text-editor/ai-text-editor.mobile.tsx", import.meta.url)).text();
const editorWeb = await Bun.file(new URL("../../../../shared/packages/ui/components/ai-text-editor/ai-text-editor.web.tsx", import.meta.url)).text();
const normalize = (source: string) => source.replace(/\s+/g, "").replace(/,([}\]])/g, "$1").replace(/\?\((?=<)/g, "?");

test("generation is contribution-gated and uses independent optimistic skeleton requests", () => {
  expect(workspace).toContain("Generate images");
  expect(workspace).toContain('collectionRole !== "viewer" && activeCollection?.access.canContribute');
  expect(workspace).toContain("generationPlaceholders.filter");
  expect(workspace).toContain('if (activeCollectionKey.current === input.collectionKey) showImageOrigin("generated")');
  expect(workspace).toContain('const visibleGenerationPlaceholders = imageOrigin === "generated"');
  expect(workspace).toContain('accessibilityLabel={`Generate images in ${activeCollection.name}`}');
  expect(workspace).toContain('onPress={() => setGenerationOpen(true)}');
  expect(normalize(workspace)).toContain(normalize('&& visibleGenerationPlaceholders.length === 0 ? <View accessibilityLabel='));
  expect(workspace).toContain("visibleGenerationPlaceholders.length === 0 && normalCollectionView");
  expect(workspace).toContain("removeGalleryGenerationPlaceholder(current, requestKey)");
  expect(workspace).toContain('const message = errorMessage(error);\n        setStatus(message);\n        notify(message);');
  expect(workspace).not.toContain("optimistic-generated-image");
});

test("composer exposes count, prompt history, and eight image-only context references", () => {
  expect(composer).toContain("([1, 2, 3] as const)");
  expect(composer).toContain('countTabs: { width: "100%"');
  expect(composer).toContain('countTab: { flex: 1 }');
  expect(composer).toContain("MAX_GALLERY_GENERATION_REFERENCES");
  expect(composer).toContain("<AiTextEditor");
  expect(composer).toContain("onOpenHistory");
  expect(composer).toContain("onClose();\n    onGenerate(input, createGalleryGenerationRequestKey())");
  expect(composer).toContain("<EmailAttachmentPicker");
  expect(composer).toContain("galleryOnly");
  expect(composer).toContain('styles.contextChip');
  expect(composer).toContain('styles.contextGrid');
  expect(composer).toContain('>Reference images</Text>');
  expect(composer).toContain('title="Reference images"');
  expect(composer).toContain('onSelectionLimitReached={(limit) => showToast({ title: `You can select up to ${limit} images.`');
  expect(picker).toContain('galleryOnly?: boolean');
  expect(picker).toContain('galleryOnly ? "gallery"');
  expect(picker).toContain('!archiveOnly && !galleryOnly');
});

test("generation history uses shared pills, usage counts, skeletons, and replacement selection", () => {
  expect(history).toContain("<SearchHistoryPill");
  expect(history).toContain("count={item.usageCount}");
  expect(history).toContain("Loading generation history");
  expect(composer).toContain("setPrompt(item.prompt)");
  expect(composer).toContain("removeCachedGalleryGenerationHistory");
});

test("AiTextEditor keeps actions optional and adds a shared Clock history action on mobile and web", () => {
  for (const source of [editorMobile, editorWeb]) {
    expect(source).toContain("onOpenActions?: () => void");
    expect(source).toContain("onOpenHistory?: () => void");
    expect(source).toContain("ClockIcon");
  }
});

test("context picker keeps Gallery browsing image-only", () => {
  expect(picker).toContain('activeTab: PickerTab = archiveOnly ? "archive" : galleryOnly ? "gallery" : tab');
  expect(picker).toContain('activeTab === "archive" ? visibleDocuments.length === 0 : visibleImages.length === 0');
  expect(picker).toContain('.filter((image) => !isManagedGalleryImage(image))');
});
