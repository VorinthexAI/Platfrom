import type { HTMLAttributes } from "react";

import { Button } from "../button/button.web";
import { CloseIcon } from "../../icons/close/close.web";

export type FilterPillProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "onClick"> & {
  disabled?: boolean;
  fullWidth?: boolean;
  label: string;
  mixed?: boolean;
  onPress: () => void;
  onRemove?: () => void;
  selected?: boolean;
};

export function FilterPill({ className = "", disabled, fullWidth = false, label, mixed = false, onPress, onRemove, selected = false, ...props }: FilterPillProps) {
  return (
    <div className={`vui-filter-pill${selected ? " is-selected" : ""}${mixed ? " is-mixed" : ""}${fullWidth ? " is-full-width" : ""} ${className}`} {...props}>
      <Button aria-label={`${mixed ? "Select for all" : selected ? "Deselect" : "Select"} ${label}`} aria-pressed={mixed ? "mixed" : selected} className="vui-filter-pill-label" disabled={disabled} onClick={onPress} size="md" variant="ghost">{label}</Button>
      {onRemove ? <Button aria-label={`Remove ${label} filter`} className="vui-filter-pill-remove" disabled={disabled} icon={<CloseIcon size="sm" />} onClick={onRemove} size="md" variant="icon">Remove filter</Button> : null}
    </div>
  );
}
