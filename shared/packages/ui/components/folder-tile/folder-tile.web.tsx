import { Button } from "../button/button.web";
import { ChevronLeftIcon } from "../../icons/chevron-left/chevron-left.web";
import { FolderIcon } from "../../icons/folder/folder.web";

export type FolderTileProps = { accessibilityLabel: string; busy?: boolean; label: string; onLongPress?: () => void; onPress: () => void; parent?: boolean; selected?: boolean; size: number };

export function FolderTile({ accessibilityLabel, busy = false, label, onPress, parent = false, selected = false, size }: FolderTileProps) {
  return <Button aria-label={accessibilityLabel} aria-busy={busy} aria-pressed={selected} onClick={onPress} style={{ width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderColor: selected ? "#F5F7F8" : undefined }} variant="ghost">
    {parent ? <ChevronLeftIcon size="lg" /> : <FolderIcon size="lg" />}{!parent ? <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{label}</span> : null}
  </Button>;
}
