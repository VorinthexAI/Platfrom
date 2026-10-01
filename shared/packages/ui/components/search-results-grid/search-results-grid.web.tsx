import type { ReactNode } from "react";
import { Button } from "../button/button.web";
import { FileIcon } from "../../icons/file/file.web";
import { FolderIcon } from "../../icons/folder/folder.web";

export type SearchResultGridItem = { key: string; label: string; kind: "file" | "folder" };
export type SearchResultsGridProps<T extends SearchResultGridItem> = {
  items: readonly T[];
  onOpen: (item: T) => void;
  renderCover?: (item: T, size: number) => ReactNode;
  renderLabel?: (item: T) => ReactNode;
  horizontalInset?: number;
};

export function SearchResultsGrid<T extends SearchResultGridItem>({ items, onOpen, renderCover, renderLabel }: SearchResultsGridProps<T>) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
    {items.map((item) => <Button aria-label={`Open ${item.label}`} key={`${item.kind}:${item.key}`} onClick={() => onOpen(item)} style={{ aspectRatio: "1", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }} variant="ghost">
      {renderCover?.(item, 80) ?? (item.kind === "folder" ? <FolderIcon size="lg" /> : <FileIcon size="lg" />)}
       {renderLabel ? renderLabel(item) : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{item.label}</span>}
    </Button>)}
  </div>;
}
