import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  return <input className={cn("vui-control", className)} type="password" {...props} />;
}
