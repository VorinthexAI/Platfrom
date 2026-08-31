import { expect, test } from "bun:test";

const route = await Bun.file(new URL("../app/share/books/[token].tsx", import.meta.url)).text();
const layout = await Bun.file(new URL("../app/_layout.tsx", import.meta.url)).text();
const sharing = await Bun.file(new URL("../components/capability/BookSharing.tsx", import.meta.url)).text();
const workspace = await Bun.file(new URL("../components/capability/AscendWorkspace.tsx", import.meta.url)).text();
const bridge = await Bun.file(new URL("./event-bridge.tsx", import.meta.url)).text();
const stream = await Bun.file(new URL("./public-book-share-stream.ts", import.meta.url)).text();
const publicApi = await Bun.file(new URL("./public-api-client.ts", import.meta.url)).text();

test("keeps nested book shares public without changing Gallery activation returns", () => {
  expect(layout).toContain('const isPublicBookShare = root === "share" && (segments as readonly string[])[1] === "books"');
  expect(layout).toContain('root === "share" && !isPublicBookShare');
  expect(layout).toContain('isPublicBookShare || root === undefined');
  expect(layout).not.toContain("BookMiniPlayer");
  expect(route).not.toContain("useAuthStore");
  expect(route).not.toContain("activateGalleryShare");
  expect(publicApi).toContain("withCredentials: false");
  expect(publicApi).not.toContain("tokenVault");
  expect(stream).not.toContain("Authorization");
});

test("provides owner link controls that converge on book changed events", () => {
  expect(workspace).toContain('>Share</BottomSheetItem>');
  expect(sharing).toContain('height="full"');
  expect(sharing).toContain('share.active ? share : await updateBookShare(book.key, true)');
  expect(sharing).toContain('accessibilityLabel={`Share ${book.title} audio book link`}');
  expect(sharing).toContain('style={styles.pillButton}');
  expect(sharing).not.toContain("<Switch");
  expect(sharing).not.toContain("loading={busy}");
  expect(sharing).toContain("NativeShare.share");
  expect(sharing).toContain('size="md" variant="primary">Share</Button>');
  expect(sharing).toContain('size="md" variant="secondary">Close</Button>');
  expect(sharing).toContain("subscribeBookChanged");
  expect(bridge).toContain("publishBookChanged()");
});

test("revokes public audio and detail immediately from strict access SSE", () => {
  expect(stream).toContain('event.event !== "access"');
  expect(stream).toContain("publicBookShareAccessSchema.parse(JSON.parse(event.data))");
  expect(stream).toContain('if (status === "inactive") stopped = true');
  expect(stream).toContain("encodeURIComponent(safeToken)");
  expect(route).toContain('status === "inactive"');
  expect(route).toContain("clearAudio();");
  expect(route).toContain("authenticatedPlayback.clear()");
  expect(route).toContain("setDetail(undefined)");
  expect(route).toContain("This shared audio book is no longer available.");
  expect(route).toContain("player.replace(null)");
  expect(route).not.toContain("updateBookChapterProgress");
});

test("renders the shared cover, chapters, reader, and retry states", () => {
  expect(route).toContain("<Cover book={detail.book} />");
  expect(route).toContain("<ChapterCard");
  expect(route).toContain("<Reader");
  expect(route).toContain("CURRENT CHAPTER");
  expect(route).toContain(">Retry</Button>");
  expect(route).toContain("useAudioPlayer(null");
});
