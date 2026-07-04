import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../utils";
export type SwitchProps = SwitchPrimitive.SwitchProps;
export function Switch({ className, ...props }: SwitchProps) {
  return <SwitchPrimitive.Root className={cn("relative inline-flex h-6 w-11 rounded-full border border-border bg-secondary data-[state=checked]:bg-accent", className)} {...props}><SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-surface transition-transform data-[state=checked]:translate-x-5" /></SwitchPrimitive.Root>;
}
