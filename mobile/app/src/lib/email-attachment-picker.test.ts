import { expect, test } from "bun:test";
import { attachmentIdentity, createAttachmentSearchOwner, isSelectableEmailDocument, latestSentEmailMessageKey, mergeEmailAttachmentSelection, toggleEmailAttachment } from "./email-attachment-picker";

test("keeps document and image identities distinct while toggling selection", () => {
  const document = { type: "document" as const, key: "same" };
  const image = { type: "image" as const, key: "same" };
  const selected = toggleEmailAttachment(toggleEmailAttachment([], document), image);
  expect(selected.map(attachmentIdentity)).toEqual(["document:same", "image:same"]);
  expect(toggleEmailAttachment(selected, document)).toEqual([image]);
});

test("merges results without clearing selections made on another picker tab", () => {
  expect(mergeEmailAttachmentSelection(
    [{ type: "document", key: "document-1" }],
    [{ type: "image", key: "image-1" }, { type: "document", key: "document-1" }],
  )).toEqual([{ type: "document", key: "document-1" }, { type: "image", key: "image-1" }]);
});

test("enforces the attachment limit without displacing existing selections", () => {
  const full = Array.from({ length: 20 }, (_, index) => ({ type: "document" as const, key: `document-${index}` }));
  expect(toggleEmailAttachment(full, { type: "image", key: "extra" })).toEqual(full);
  expect(mergeEmailAttachmentSelection(full, [{ type: "image", key: "extra" }])).toHaveLength(20);
});

test("all twenty selected attachments remain individually removable", () => {
  let selected = Array.from({ length: 20 }, (_, index) => ({ type: "document" as const, key: `document-${index}` }));
  for (const ref of [...selected]) selected = toggleEmailAttachment(selected, ref);
  expect(selected).toEqual([]);
});

for (const boundary of ["query", "tab", "close", "context"] as const) {
  test(`${boundary} invalidation aborts and suppresses a deferred attachment search`, async () => {
    const owner = createAttachmentSearchOwner();
    const operation = owner.begin();
    let resolve!: (value: string) => void;
    const deferred = new Promise<string>((complete) => { resolve = complete; });
    let published: string | undefined;
    const completion = deferred.then((value) => { if (owner.isCurrent(operation.generation)) published = value; });
    owner.invalidate();
    expect(operation.signal.aborted).toBe(true);
    resolve("stale result");
    await completion;
    expect(published).toBeUndefined();
  });
}

test("selects the latest outbound message deterministically without provider identifiers", () => {
  const messages = [
    { key: "inbound", direction: "inbound" as const, sentAt: "2026-08-23T10:00:00.000Z" },
    { key: "older-sent", direction: "outbound" as const, sentAt: "2026-08-23T11:00:00.000Z" },
    { key: "latest-sent", direction: "outbound" as const, sentAt: "2026-08-23T12:00:00.000Z" },
  ];
  expect(latestSentEmailMessageKey(messages)).toBe("latest-sent");
});

test("selects named user documents returned from managed folders", () => {
  expect(isSelectableEmailDocument({ key: "tone-document", name: "Warm and concise", folderKey: "managed-custom-tones" })).toBe(true);
  expect(isSelectableEmailDocument({ documentKey: "search-tone-document", name: "Direct but friendly", folderKey: "managed-custom-tones" })).toBe(true);
});

test("rejects malformed unnamed documents", () => {
  expect(isSelectableEmailDocument({ key: "missing-name" })).toBe(false);
  expect(isSelectableEmailDocument({ documentKey: "blank-name", name: "   " })).toBe(false);
});
