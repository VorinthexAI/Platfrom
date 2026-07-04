import * as RadioPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../utils";
export const RadioGroup = RadioPrimitive.Root;
export type RadioGroupItemProps = RadioPrimitive.RadioGroupItemProps;
export function RadioGroupItem({ className, ...props }: RadioGroupItemProps) {
  return <RadioPrimitive.Item className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background", className)} {...props}><RadioPrimitive.Indicator className="h-2.5 w-2.5 rounded-full bg-accent" /></RadioPrimitive.Item>;
}
