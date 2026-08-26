"use client";

import { Slot } from "@radix-ui/react-slot";
import { createContext, forwardRef, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";

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
  iconOnly?: boolean;
  loading?: boolean;
  shape?: ButtonShape;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

type ButtonSizeContextValue = { size: ButtonSize; forced: boolean };
const ButtonSizeContext = createContext<ButtonSizeContextValue | undefined>(undefined);

export function ButtonSizeProvider({ children, force = false, size }: { children: ReactNode; force?: boolean; size: ButtonSize }) {
  const parent = useContext(ButtonSizeContext);
  const value = parent?.forced ? parent : { size, forced: force };
  return <ButtonSizeContext.Provider value={value}>{children}</ButtonSizeContext.Provider>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    children,
    className,
    disabled,
    icon,
    iconOnly = false,
    loading = false,
    shape = "pill",
    size: requestedSize = "md",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  const size = useContext(ButtonSizeContext)?.size ?? requestedSize;
  const classes = cn(
    "vui-button",
    `vui-button-${variant}`,
    `vui-button-${size}`,
    `vui-button-${shape}`,
    iconOnly && "vui-button-icon-only",
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
      {variant === "icon" || iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  );
});
