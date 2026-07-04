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
  variant?: ButtonVariant;
};

export function Button({
  asChild = false,
  children,
  className,
  icon,
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn("vui-button", `vui-button-${variant}`, className)}
      type={asChild ? undefined : type}
      {...props}
    >
      {icon}
      {variant === "icon" ? <span className="sr-only">{children}</span> : children}
    </Component>
  );
}
