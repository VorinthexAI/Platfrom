import type { HTMLAttributes } from "react";
export type NavbarProps = HTMLAttributes<HTMLDivElement>;
export function Navbar({ className = "", ...props }: NavbarProps) {
  return <div className={["vui-navbar", className].filter(Boolean).join(" ")} {...props} />;
}
