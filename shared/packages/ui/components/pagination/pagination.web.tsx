import type { HTMLAttributes } from "react";
export type PaginationProps = HTMLAttributes<HTMLDivElement>;
export function Pagination({ className = "", ...props }: PaginationProps) {
  return <div className={["vui-pagination", className].filter(Boolean).join(" ")} {...props} />;
}
