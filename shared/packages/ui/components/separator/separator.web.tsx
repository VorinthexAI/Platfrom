import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
export type SeparatorProps = HTMLAttributes<HTMLHRElement>;
export function Separator({ className, ...props }: SeparatorProps) {
  return <hr className={cn("vui-divider", className)} {...props} />;
}
