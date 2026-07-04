import type { HTMLAttributes } from "react";
export type LogoMarkProps = HTMLAttributes<HTMLDivElement>;
export function LogoMark({ className = "", ...props }: LogoMarkProps) {
  return <div className={["vui-logo-mark", className].filter(Boolean).join(" ")} {...props} />;
}
