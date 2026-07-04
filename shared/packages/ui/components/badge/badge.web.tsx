import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
export type BadgeProps = HTMLAttributes<HTMLSpanElement>;
export function Badge({ className, ...props }: BadgeProps) {
  return <span className={cn("vui-badge", className)} {...props} />;
}
