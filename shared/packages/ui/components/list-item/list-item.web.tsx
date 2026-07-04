import type { HTMLAttributes } from "react";
export type ListItemProps = HTMLAttributes<HTMLDivElement>;
export function ListItem({ className = "", ...props }: ListItemProps) {
  return <div className={["vui-list-item", className].filter(Boolean).join(" ")} {...props} />;
}
