import type { HTMLAttributes } from "react";

export type AlertVariant = "info" | "danger";

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
};

export function Alert({ className = "", variant = "info", ...props }: AlertProps) {
  return (
    <div
      className={["vui-alert", `vui-alert-${variant}`, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
