import type { HTMLAttributes } from "react";
export type EmptyStateProps = HTMLAttributes<HTMLDivElement>;
export function EmptyState({ className = "", ...props }: EmptyStateProps) {
  return <div className={["vui-empty-state", className].filter(Boolean).join(" ")} {...props} />;
}
