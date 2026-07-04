import type { HTMLAttributes } from "react";
export type ToolbarProps = HTMLAttributes<HTMLDivElement>;
export function Toolbar({ className = "", ...props }: ToolbarProps) {
  return <div className={["vui-toolbar", className].filter(Boolean).join(" ")} {...props} />;
}
