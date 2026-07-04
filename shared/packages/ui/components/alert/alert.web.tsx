import type { HTMLAttributes } from "react";
export type AlertProps = HTMLAttributes<HTMLDivElement>;
export function Alert({ className = "", ...props }: AlertProps) {
  return <div className={["vui-alert", className].filter(Boolean).join(" ")} {...props} />;
}
