import { expect, test } from "bun:test";
import { attachmentIdentity, isSelectableEmailDocument, mergeEmailAttachmentSelection, toggleEmailAttachment } from "./email-attachment-picker";

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

test("excludes determinable managed communication documents", () => {
  expect(isSelectableEmailDocument({ key: "one", name: "Project brief.pdf" })).toBe(true);
  expect(isSelectableEmailDocument({ key: "two", name: "Signal thread 2026-08-23" })).toBe(false);
  expect(isSelectableEmailDocument({ documentKey: "three", name: "email_message_123" })).toBe(false);
});
