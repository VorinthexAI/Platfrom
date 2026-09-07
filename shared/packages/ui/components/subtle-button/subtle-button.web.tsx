"use client";

import { forwardRef, type ComponentProps } from "react";

import { Button } from "../button/button.web";
import { cn } from "../../utils";

export type SubtleButtonProps = Omit<ComponentProps<typeof Button>, "variant">;

export const SubtleButton = forwardRef<HTMLButtonElement, SubtleButtonProps>(function SubtleButton(
  { className, size = "md", ...props },
  ref,
) {
  return <Button className={cn("vui-subtle-button", className)} ref={ref} size={size} variant="ghost" {...props} />;
});
