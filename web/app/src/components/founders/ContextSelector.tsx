"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@vorinthex/shared/ui/components";

export interface ContextOption {
  key: string;
  name: string;
  /** Optional secondary line (alias, path). */
  hint?: string | null;
  /** Indent level for hierarchical options. */
  depth?: number;
}

interface ContextSelectorProps {
  label: string;
  placeholder: string;
  value: string | null;
  options: ContextOption[];
  onChange: (key: string) => void;
  disabled?: boolean;
}

/**
 * One labeled dropdown on the obsidian surface — used for the organization
 * and scope selectors. Radix Select supplies the keyboard navigation,
 * Escape-to-close, and listbox ARIA semantics.
 */
export function ContextSelector({ label, placeholder, value, options, onChange, disabled }: ContextSelectorProps) {
  return (
    <label className="block">
      <span className="micro-label block text-silver-500">{label}</span>
      <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled || options.length === 0}>
        <SelectTrigger
          aria-label={label}
          className="founders-surface mt-2 w-full rounded-xl px-4 py-3 text-left text-sm text-silver-100 transition-colors data-[state=open]:border-white/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          sideOffset={8}
          className="founders-surface z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl"
        >
          <SelectViewport className="max-h-72 p-1.5">
            {options.map((option) => (
              <SelectItem
                key={option.key}
                value={option.key}
                className="rounded-lg text-sm text-silver-300 transition-colors data-[highlighted]:bg-white/8 data-[highlighted]:text-silver-50 data-[state=checked]:text-silver-50"
                style={option.depth ? { paddingLeft: `${12 + option.depth * 14}px` } : undefined}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.name}</span>
                  {option.hint ? (
                    <span className="truncate font-mono text-[0.6rem] tracking-[0.14em] text-silver-500 uppercase">
                      {option.hint}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectViewport>
        </SelectContent>
      </Select>
    </label>
  );
}
