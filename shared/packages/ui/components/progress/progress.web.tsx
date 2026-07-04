import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "../../utils";
export type ProgressProps = ProgressPrimitive.ProgressProps;
export function Progress({ className, value = 0, ...props }: ProgressProps) {
  return <ProgressPrimitive.Root className={cn("h-2 overflow-hidden rounded-full bg-secondary", className)} {...props}><ProgressPrimitive.Indicator className="h-full bg-accent transition-transform" style={{ transform: `translateX(-${100 - Number(value)}%)` }} /></ProgressPrimitive.Root>;
}
