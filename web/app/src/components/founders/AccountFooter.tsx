"use client";

import { ChevronRightIcon } from "@vorinthex/shared/ui/icons";

interface AccountFooterProps {
  name: string;
  secondary: string;
  onOpen(): void;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** Clickable identity row at the bottom of the left panel. */
export function AccountFooter({ name, secondary, onOpen }: AccountFooterProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open Account"
      className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-white/10 hover:bg-black/25"
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 font-mono text-[0.65rem] tracking-[0.12em] text-silver-100"
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-silver-100">{name}</span>
        <span className="block truncate font-mono text-[0.6rem] tracking-[0.18em] text-silver-500 uppercase">
          {secondary}
        </span>
      </span>
      <ChevronRightIcon size="sm" className="shrink-0 text-silver-500 transition-colors group-hover:text-silver-100" />
    </button>
  );
}
