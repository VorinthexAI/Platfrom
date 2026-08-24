import type { ContentDocument, ContentSearchDocument } from "./content-client";
import type { EmailAttachmentRef } from "./email-client";

type EmailDocumentCandidate =
  | Pick<ContentDocument, "key" | "folderKey"> & Partial<Pick<ContentDocument, "name">>
  | Pick<ContentSearchDocument, "documentKey" | "folderKey"> & Partial<Pick<ContentSearchDocument, "name">>;

export function isSelectableEmailDocument(document: EmailDocumentCandidate) {
  const key = "key" in document ? document.key : document.documentKey;
  return Boolean(key && document.name?.trim());
}

export function attachmentIdentity(ref: EmailAttachmentRef) { return `${ref.type}:${ref.key}`; }

export function toggleEmailAttachment(selection: EmailAttachmentRef[], ref: EmailAttachmentRef) {
  const identity = attachmentIdentity(ref);
  return selection.some((item) => attachmentIdentity(item) === identity)
    ? selection.filter((item) => attachmentIdentity(item) !== identity)
    : selection.length >= 20 ? selection : [...selection, ref];
}

export function mergeEmailAttachmentSelection(selection: EmailAttachmentRef[], additions: EmailAttachmentRef[]) {
  const merged = new Map(selection.map((item) => [attachmentIdentity(item), item]));
  additions.forEach((item) => merged.set(attachmentIdentity(item), item));
  return [...merged.values()].slice(0, 20);
}

export function latestSentEmailMessageKey(messages: { key: string; direction: "inbound" | "outbound"; sentAt: string }[]) {
  return [...messages]
    .filter(({ direction }) => direction === "outbound")
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0]?.key;
}

export function createAttachmentSearchOwner() {
  let generation = 0;
  let controller: AbortController | undefined;
  return {
    begin() {
      generation += 1;
      controller?.abort();
      controller = new AbortController();
      return { generation, signal: controller.signal };
    },
    invalidate() {
      generation += 1;
      controller?.abort();
      controller = undefined;
    },
    isCurrent(candidate: number) {
      return candidate === generation && !controller?.signal.aborted;
    },
  };
}
