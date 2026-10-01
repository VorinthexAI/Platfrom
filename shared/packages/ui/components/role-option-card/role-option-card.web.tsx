import type { ReactNode } from "react";
import { Button } from "../button/button.web";

export type RoleOptionCardProps = {
  description?: string;
  icon: ReactNode;
  label: string;
  onPress: () => void;
  selected: boolean;
  width: number;
};

export function RoleOptionCard({ description, icon, label, onPress, selected, width }: RoleOptionCardProps) {
  return <Button aria-label={`${label} role`} aria-pressed={selected} onClick={onPress} style={{ width, height: 94, display: "flex", flexDirection: "column", gap: 8, borderColor: selected ? "#F5F7F8" : undefined }} title={description} variant="secondary">
    {icon}<span>{label}</span>
  </Button>;
}
