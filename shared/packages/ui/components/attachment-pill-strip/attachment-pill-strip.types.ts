import type { ReactNode } from "react";

export type AttachmentPillItem = {
  key: string;
  name: string;
  icon: ReactNode;
  onRemove: () => void;
  onOpen?: () => void;
};

export type AttachmentPillStripProps = {
  items: readonly AttachmentPillItem[];
  disabled?: boolean;
};
