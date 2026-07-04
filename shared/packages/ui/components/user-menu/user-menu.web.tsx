import type { HTMLAttributes } from "react";
export type UserMenuProps = HTMLAttributes<HTMLDivElement>;
export function UserMenu({ className = "", ...props }: UserMenuProps) {
  return <div className={["vui-user-menu", className].filter(Boolean).join(" ")} {...props} />;
}
