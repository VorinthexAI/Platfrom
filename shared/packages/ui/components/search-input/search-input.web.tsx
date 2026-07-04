import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export function SearchInput({ className, ...props }: SearchInputProps) {
  return <input className={cn("vui-control", className)} type="search" {...props} />;
}
