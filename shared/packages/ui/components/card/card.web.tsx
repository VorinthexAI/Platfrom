import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
export type CardProps = HTMLAttributes<HTMLDivElement>;
export function Card({ className, ...props }: CardProps) {
  return <div className={cn("vui-card", className)} {...props} />;
}
