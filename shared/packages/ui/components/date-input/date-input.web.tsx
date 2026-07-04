import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export function DateInput({ className, ...props }: DateInputProps) {
  return <input className={cn("vui-control", className)} type="date" {...props} />;
}
