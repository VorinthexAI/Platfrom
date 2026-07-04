import type { HTMLAttributes } from "react";
export type StepperProps = HTMLAttributes<HTMLDivElement>;
export function Stepper({ className = "", ...props }: StepperProps) {
  return <div className={["vui-stepper", className].filter(Boolean).join(" ")} {...props} />;
}
