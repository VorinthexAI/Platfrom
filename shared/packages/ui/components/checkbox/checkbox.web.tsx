import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "../../icons/check";
import { cn } from "../../utils";
export type CheckboxProps = CheckboxPrimitive.CheckboxProps;
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root className={cn("vui-control inline-flex h-5 min-h-5 w-5 items-center justify-center p-0", className)} {...props}>
      <CheckboxPrimitive.Indicator><CheckIcon size="sm" variant="accent" /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
