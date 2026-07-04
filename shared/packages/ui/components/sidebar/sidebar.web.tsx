import type { HTMLAttributes } from "react";
export type SidebarProps = HTMLAttributes<HTMLDivElement>;
export function Sidebar({ className = "", ...props }: SidebarProps) {
  return <div className={["vui-sidebar", className].filter(Boolean).join(" ")} {...props} />;
}
