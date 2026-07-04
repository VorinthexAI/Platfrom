import type { HTMLAttributes } from "react";
export type DataGridProps = HTMLAttributes<HTMLDivElement>;
export function DataGrid({ className = "", ...props }: DataGridProps) {
  return <div className={["vui-data-grid", className].filter(Boolean).join(" ")} {...props} />;
}
