import type { HTMLAttributes } from "react";
export type TimelineProps = HTMLAttributes<HTMLDivElement>;
export function Timeline({ className = "", ...props }: TimelineProps) {
  return <div className={["vui-timeline", className].filter(Boolean).join(" ")} {...props} />;
}
