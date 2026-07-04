import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../utils";
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return <textarea className={cn("vui-control", className)} rows={rows} {...props} />;
}
