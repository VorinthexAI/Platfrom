import type { InputHTMLAttributes } from "react";
import { cn } from "../../utils";
export type FileUploadProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export function FileUpload({ className, ...props }: FileUploadProps) {
  return <input className={cn("vui-control", className)} type="file" {...props} />;
}
