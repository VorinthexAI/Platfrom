import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
export type SpinnerProps = HTMLAttributes<HTMLSpanElement>;
export function Spinner({ className, ...props }: SpinnerProps) {
  return <span className={cn("vui-spinner", className)} aria-hidden="true" {...props} />;
}
