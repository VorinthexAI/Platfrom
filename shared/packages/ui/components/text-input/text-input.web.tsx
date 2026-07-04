import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;
export function TextInput({ className, type = "text", ...props }: TextInputProps) {
  return <input className={cn("vui-control", className)} type={type} {...props} />;
}
