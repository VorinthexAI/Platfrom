import type { HTMLAttributes } from "react";
export type BreadcrumbsProps = HTMLAttributes<HTMLDivElement>;
export function Breadcrumbs({ className = "", ...props }: BreadcrumbsProps) {
  return <div className={["vui-breadcrumbs", className].filter(Boolean).join(" ")} {...props} />;
}
