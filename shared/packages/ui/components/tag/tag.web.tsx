import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
export type TagProps = HTMLAttributes<HTMLSpanElement>;
export function Tag({ className, ...props }: TagProps) {
  return <span className={cn("vui-tag", className)} {...props} />;
}
