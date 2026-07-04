import type { HTMLAttributes } from "react";
export type ValidationMessageProps = HTMLAttributes<HTMLDivElement>;
export function ValidationMessage({ className = "", ...props }: ValidationMessageProps) {
  return <div className={["vui-validation-message", className].filter(Boolean).join(" ")} {...props} />;
}
