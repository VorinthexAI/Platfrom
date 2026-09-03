import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { autoFocusInBottomSheet?: boolean };
export function TextInput({ autoFocusInBottomSheet: _autoFocusInBottomSheet, className, type = "text", ...props }: TextInputProps) {
  return <input className={cn("vui-control", className)} type={type} {...props} />;
}
