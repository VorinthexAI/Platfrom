import type { HTMLAttributes, ReactNode } from "react";

import { Button } from "../button/button.web";

export type ActionPillProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  action?: ReactNode;
  actionLabel?: string;
  actionSelected?: boolean;
  appearance?: "default" | "plain" | "reorder";
  children: ReactNode;
  compact?: boolean;
  dense?: boolean;
  disabled?: boolean;
  fitContent?: boolean;
  onAction?: () => void;
  onLongPress?: () => void;
  onPress?: () => void;
  pressLabel?: string;
  secondaryAction?: ReactNode;
  secondaryActionLabel?: string;
  secondaryActionSelected?: boolean;
  onSecondaryAction?: () => void;
};

export function ActionPill({ action, actionLabel, actionSelected, appearance = "default", children, className = "", compact = false, dense = false, disabled, fitContent = false, onAction, onLongPress, onPress, onSecondaryAction, pressLabel, secondaryAction, secondaryActionLabel, secondaryActionSelected, ...props }: ActionPillProps) {
  return <div className={`vui-action-pill${compact ? " vui-action-pill--compact" : ""}${dense ? " vui-action-pill--dense" : ""}${fitContent ? " vui-action-pill--fit" : ""}${appearance === "plain" ? " vui-action-pill--plain" : ""}${appearance === "reorder" ? " vui-action-pill--reorder" : ""} ${className}`} {...props}>
    {onPress ? <Button aria-label={pressLabel} className="vui-action-pill-main" disabled={disabled} onClick={onPress} onContextMenu={onLongPress ? (event) => { event.preventDefault(); onLongPress(); } : undefined} size="sm" variant="ghost">{children}</Button> : <div className="vui-action-pill-main">{children}</div>}
    {action && onAction ? <Button aria-label={actionLabel} aria-pressed={actionSelected} className="vui-action-pill-action" disabled={disabled} onClick={onAction} size="xs" variant={actionSelected ? "primary" : appearance === "plain" ? "icon" : "secondary"}>{action}</Button> : null}
    {secondaryAction && onSecondaryAction ? <Button aria-label={secondaryActionLabel} aria-pressed={secondaryActionSelected} className="vui-action-pill-action" disabled={disabled} onClick={onSecondaryAction} size="xs" variant={secondaryActionSelected ? "primary" : "secondary"}>{secondaryAction}</Button> : null}
  </div>;
}
