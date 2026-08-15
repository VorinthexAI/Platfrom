import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "../../utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "icon";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";
export type ButtonShape = "pill" | "rounded";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  shape?: ButtonShape;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    children,
    className,
    disabled,
    icon,
    loading = false,
    shape = "pill",
    size = "md",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  const classes = cn(
    "vui-button",
    `vui-button-${variant}`,
    `vui-button-${size}`,
    `vui-button-${shape}`,
    className,
  );

  // Slot (Radix) requires exactly one child element to merge props onto, so
  // asChild can't also render an icon/spinner as a sibling — pass the
  // wrapped child straight through.
  if (asChild) {
    return (
      <Slot className={classes} ref={ref} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      aria-busy={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      ref={ref}
      type={type}
      {...props}
    >
      {loading ? <span aria-hidden="true" className="vui-button-fill" /> : icon}
      {variant === "icon" ? <span className="sr-only">{children}</span> : children}
    </button>
  );
});
