import type { HTMLAttributes } from "react";
export type FormFieldProps = HTMLAttributes<HTMLDivElement>;
export function FormField({ className = "", ...props }: FormFieldProps) {
  return <div className={["vui-form-field", className].filter(Boolean).join(" ")} {...props} />;
}
