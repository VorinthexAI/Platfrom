import type { ReactNode } from "react";
import { Button } from "../button/button.web";

export type CapabilityTileProps = { icon: ReactNode; label: string; onPress: () => void; size: number };

export function CapabilityTile({ icon, label, onPress, size }: CapabilityTileProps) {
  return <Button aria-label={`Open ${label}`} onClick={onPress} style={{ width: size, height: size, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, padding: 2 }} variant="ghost">
    {icon}<span style={{ fontSize: 10, textAlign: "center", whiteSpace: "normal" }}>{label}</span>
  </Button>;
}
