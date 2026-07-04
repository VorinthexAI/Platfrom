import * as ToastPrimitive from "@radix-ui/react-toast";

import { cn } from "../../utils";

export const ToastProvider = ToastPrimitive.Provider;
export const ToastViewport = ToastPrimitive.Viewport;
export const ToastAction = ToastPrimitive.Action;
export const ToastClose = ToastPrimitive.Close;
export const ToastTitle = ToastPrimitive.Title;
export const ToastDescription = ToastPrimitive.Description;

export type ToastProps = ToastPrimitive.ToastProps;

export function Toast({ className, ...props }: ToastProps) {
  return <ToastPrimitive.Root className={cn("vui-panel", className)} {...props} />;
}
