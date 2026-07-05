"use client";

// neural-map.md §6.2 — header layout (left to right): logo mark · thread
// title / breadcrumb · spacer · mode-toggle icon button · user menu.

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import type { Session } from "@/server/dal/session";
import { LogoMark } from "@vorinthex/shared/ui";
import { UserMenu as UserMenuFrame } from "@vorinthex/shared/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vorinthex/shared/ui";
import { SettingsIcon } from "@vorinthex/shared/ui";
import { LogOutIcon } from "@vorinthex/shared/ui";

import { useConsoleModeStore } from "../store/console-mode-store";
import { ModeToggleButton } from "./mode-toggle-button";

// Split into its own module and dynamic-imported (ssr: false) because it
// statically imports from `@/features/universe/**` — see
// universe-breadcrumb.tsx's comment for why that can't be a static import
// here (this header renders in both modes).
const UniverseBreadcrumb = dynamic(
  () => import("./universe-breadcrumb").then((mod) => mod.UniverseBreadcrumb),
  { ssr: false, loading: () => <span className="vx-console-breadcrumb">Universe</span> },
);

export type ConsoleHeaderProps = {
  session: Session;
};

export function ConsoleHeader({ session }: ConsoleHeaderProps) {
  const mode = useConsoleModeStore((state) => state.mode);
  const hasOtherModeActivity = useConsoleModeStore(
    (state) => state.hasOtherModeActivity,
  );
  const setMode = useConsoleModeStore((state) => state.setMode);
  const pathname = usePathname();

  const onToggleMode = () => setMode(mode === "chat" ? "universe" : "chat");

  return (
    <header className="vx-console-header">
      <div className="vx-console-header-logo">
        {/* `LogoMark` (src/shared/packages/ui) is an unstyled content slot
            with no default mark of its own — pass a wordmark fallback so
            the header isn't blank on the left. */}
        <LogoMark aria-hidden>
          <span className="vx-console-logo-text">Vorinthex</span>
        </LogoMark>
      </div>

      {mode === "chat" ? (
        <span className="vx-console-breadcrumb">
          {chatBreadcrumbLabel(pathname)}
        </span>
      ) : (
        <UniverseBreadcrumb />
      )}

      <span className="vx-console-header-spacer" />

      <ModeToggleButton
        mode={mode}
        onToggleMode={onToggleMode}
        hasOtherModeActivity={hasOtherModeActivity}
      />

      <AccountMenu session={session} />
    </header>
  );
}

function chatBreadcrumbLabel(pathname: string | null): string {
  if (!pathname || pathname.endsWith("/c/new")) return "New chat";
  return "Chat";
}

function AccountMenu({ session }: { session: Session }) {
  const initial = session.displayName?.trim()?.[0]?.toUpperCase() ?? "?";

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/signin";
    }
  }

  return (
    <UserMenuFrame className="vx-console-user-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="vx-user-menu-trigger" aria-label="Account menu">
            <span className="vx-user-menu-avatar">
              {session.avatarUrl ? (
                <img src={session.avatarUrl} alt="" />
              ) : (
                initial
              )}
            </span>
            <span className="vx-user-menu-name">{session.displayName}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="vx-dropdown-content" align="end" sideOffset={8}>
          <DropdownMenuItem className="vx-dropdown-item" asChild>
            <a href="/console/settings">
              <SettingsIcon size="sm" aria-hidden />
              Settings
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="vx-dropdown-separator" />
          <DropdownMenuItem
            className="vx-dropdown-item"
            data-danger
            onSelect={handleLogout}
          >
            <LogOutIcon size="sm" variant="danger" aria-hidden />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </UserMenuFrame>
  );
}
