import type { HTMLAttributes } from "react";
export type SkeletonProps = HTMLAttributes<HTMLDivElement>;
export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return <div className={["vui-skeleton", className].filter(Boolean).join(" ")} {...props} />;
}
