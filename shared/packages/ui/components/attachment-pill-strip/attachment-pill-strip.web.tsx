import { ActionPill } from "../action-pill/action-pill.web";
import { CloseIcon } from "../../icons/close/close.web";
import type { AttachmentPillStripProps } from "./attachment-pill-strip.types";

export type { AttachmentPillItem, AttachmentPillStripProps } from "./attachment-pill-strip.types";

export function AttachmentPillStrip({ items, disabled }: AttachmentPillStripProps) {
  if (!items.length) return null;
  return <div aria-label="Draft attachments" style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: 6, height: 28, overflowX: "auto", paddingInline: 2 }}>
    {items.map((item) => <ActionPill action={<CloseIcon size="sm" />} actionLabel={`Remove ${item.name}`} compact dense disabled={disabled} fitContent key={item.key} onAction={item.onRemove} onPress={item.onOpen} pressLabel={item.onOpen ? `Open ${item.name}` : undefined} style={{ backgroundColor: "var(--vui-color-page)", flexShrink: 0, maxWidth: 158 }}><span style={{ alignItems: "center", display: "flex", flexShrink: 1, gap: 5 }}>{item.icon}<span style={{ color: "var(--vui-color-text)", fontSize: 11, maxWidth: 88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span></span></ActionPill>)}
  </div>;
}
