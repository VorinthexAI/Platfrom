import type { ContentDocument, ContentSearchDocument } from "./content-client";
import type { EmailAttachmentRef } from "./email-client";

const MANAGED_COMMUNICATION_NAME = /^(?:\.?signal(?:[-_ ]|$)|email[-_ ](?:thread|message|sync)|managed[-_ ]communication)/i;

export function isSelectableEmailDocument(document: Pick<ContentDocument, "key" | "name"> | Pick<ContentSearchDocument, "documentKey" | "name">) {
  const key = "key" in document ? document.key : document.documentKey;
  return Boolean(key && document.name.trim() && !MANAGED_COMMUNICATION_NAME.test(document.name.trim()));
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
