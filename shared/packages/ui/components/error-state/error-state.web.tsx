import type { HTMLAttributes } from "react";
export type ErrorStateProps = HTMLAttributes<HTMLDivElement>;
export function ErrorState({ className = "", ...props }: ErrorStateProps) {
  return <div className={["vui-error-state", className].filter(Boolean).join(" ")} {...props} />;
}
