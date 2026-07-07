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
  const classes = cn("vui-button", `vui-button-${variant}`, className);

  // Slot (Radix) requires exactly one child element to merge props onto, so
  // asChild can't also render an icon/spinner as a sibling — pass the
  // wrapped child straight through.
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      aria-busy={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? <span aria-hidden="true" className="vui-button-fill" /> : icon}
      {variant === "icon" ? <span className="sr-only">{children}</span> : children}
    </button>
  );
}
