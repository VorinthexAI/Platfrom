import * as SelectPrimitive from "@radix-ui/react-select";

import { CheckIcon } from "../../icons/check";
import { ChevronDownIcon } from "../../icons/chevron-down";
import { cn } from "../../utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export type SelectTriggerProps = SelectPrimitive.SelectTriggerProps;

export function SelectTrigger({ className, children, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger className={cn("vui-control flex items-center justify-between", className)} {...props}>
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon size="sm" variant="accent" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export const SelectContent = SelectPrimitive.Content;
export const SelectViewport = SelectPrimitive.Viewport;
export const SelectLabel = SelectPrimitive.Label;
export const SelectSeparator = SelectPrimitive.Separator;

export type SelectItemProps = SelectPrimitive.SelectItemProps;

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item className={cn("relative flex cursor-pointer items-center gap-2 px-3 py-2 text-foreground outline-none data-[highlighted]:text-accent", className)} {...props}>
      <SelectPrimitive.ItemIndicator>
        <CheckIcon size="sm" variant="accent" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
