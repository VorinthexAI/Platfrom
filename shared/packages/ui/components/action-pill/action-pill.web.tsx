import type { HTMLAttributes, ReactNode } from "react";

import { Button } from "../button/button.web";

export type ActionPillProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  action?: ReactNode;
  actionLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  onAction?: () => void;
  onPress?: () => void;
  pressLabel?: string;
};

export function ActionPill({ action, actionLabel, children, className = "", disabled, onAction, onPress, pressLabel, ...props }: ActionPillProps) {
  return <div className={`vui-action-pill ${className}`} {...props}>
    {onPress ? <Button aria-label={pressLabel} className="vui-action-pill-main" disabled={disabled} onClick={onPress} size="sm" variant="ghost">{children}</Button> : <div className="vui-action-pill-main">{children}</div>}
    {action && onAction ? <Button aria-label={actionLabel} className="vui-action-pill-action" disabled={disabled} onClick={onAction} size="xs" variant="secondary">{action}</Button> : null}
  </div>;
}
