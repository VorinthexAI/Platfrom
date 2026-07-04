import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../utils";
export type SliderProps = SliderPrimitive.SliderProps;
export function Slider({ className, ...props }: SliderProps) {
  return <SliderPrimitive.Root className={cn("relative flex h-5 w-full items-center", className)} {...props}><SliderPrimitive.Track className="relative h-px grow bg-border"><SliderPrimitive.Range className="absolute h-full bg-accent" /></SliderPrimitive.Track><SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-accent bg-surface" /></SliderPrimitive.Root>;
}
