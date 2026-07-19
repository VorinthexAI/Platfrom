"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@vorinthex/shared/ui/components";
import {
  FoundersRequestError,
  fetchAccessibleOrganizations,
  fetchFoundersAccount,
} from "@/lib/founders/client";
import type { AccessibleOrganizationOption, FoundersAccount } from "@/lib/founders/types";
import { FoundersBackdrop } from "./FoundersBackdrop";

const ORGANIZATION_STORAGE_KEY = "vx_founders_organization";

type GateState = "checking" | "ready" | "error";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between">
      <dt className="text-sm text-silver-500">{label}</dt>
      <dd className="text-sm text-silver-100 sm:text-right">{value}</dd>
    </div>
  );
}

function displayRole(title: string | null, role: string): string {
  const titleRole = title?.trim().split(/\s+/).at(-1);
  return titleRole || `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

/**
 * Read-only account page: identity, roles, current organization, logout.
 * Subtle dividers instead of cards, nothing editable, no management.
 */
export function FoundersAccountPage() {
  const router = useRouter();
  const [gate, setGate] = useState<GateState>("checking");
  const [account, setAccount] = useState<FoundersAccount | null>(null);
  const [organizations, setOrganizations] = useState<AccessibleOrganizationOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loadedAccount, loadedOrganizations] = await Promise.all([
          fetchFoundersAccount(),
          fetchAccessibleOrganizations(),
        ]);
        if (cancelled) return;
        setAccount(loadedAccount);
        setOrganizations(loadedOrganizations);
        setGate("ready");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof FoundersRequestError && (error.status === 401 || error.status === 403)) {
          window.location.replace("/nexus");
          return;
        }
        setGate("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const currentOrganization = useMemo(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(ORGANIZATION_STORAGE_KEY) : null;
    return organizations.find((organization) => organization.key === stored)
      ?? organizations[0]
      ?? null;
  }, [organizations]);

  function signOut() {
    // Clear visible local session state and leave immediately; keepalive lets
    // the cookie-clearing request finish after navigation begins.
    for (const key of ["vx_member_name", "vx_member_title", "vx_member_email"]) {
      window.localStorage.removeItem(key);
    }
    void fetch("/api/auth/signout", { method: "POST", keepalive: true });
    router.replace("/");
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
      <FoundersBackdrop />
      <div className="relative z-10 flex min-h-svh justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-xl">
          {gate !== "ready" ? (
            <p aria-live="polite" className="mt-16 text-center text-sm text-silver-300">
              {gate === "checking" ? "Verifying access…" : "The account page could not load. Refresh to retry."}
            </p>
          ) : account ? (
            <>
              <dl className="divide-y divide-white/8 border-y border-white/8">
                <Row label="Name" value={account.user.name ?? "—"} />
                <Row label="Alias" value={account.user.alias ?? "—"} />
                <Row label="Email" value={account.user.email} />
                <Row
                  label="Role"
                  value={displayRole(account.rootMembership.title, account.rootMembership.role)}
                />
                <Row label="Current organization" value={currentOrganization?.name ?? account.rootOrganization.name} />
              </dl>
              <div className="mt-8 flex items-center gap-3">
                <Button asChild variant="primary">
                  <Link href="/nexus">Back</Link>
                </Button>
                <Button type="button" onClick={signOut} variant="secondary">Sign out</Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
