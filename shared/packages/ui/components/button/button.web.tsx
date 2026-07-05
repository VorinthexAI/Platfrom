import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "icon";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  variant?: ButtonVariant;
};

export function Button({
  asChild = false,
  children,
  className,
  disabled,
  icon,
  loading = false,
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      aria-busy={loading || undefined}
      className={cn("vui-button", `vui-button-${variant}`, className)}
      disabled={asChild ? undefined : disabled || loading}
      type={asChild ? undefined : type}
      {...props}
    >
      {loading ? <span aria-hidden="true" className="vui-spinner" /> : icon}
      {variant === "icon" ? <span className="sr-only">{children}</span> : children}
    </Component>
  );
}
