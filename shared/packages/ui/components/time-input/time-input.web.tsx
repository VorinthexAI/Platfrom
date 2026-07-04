import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type TimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export function TimeInput({ className, ...props }: TimeInputProps) {
  return <input className={cn("vui-control", className)} type="time" {...props} />;
}
