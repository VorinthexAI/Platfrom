"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOutIcon } from "@vorinthex/shared/ui/icons";
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
      <dt className="micro-label text-silver-500">{label}</dt>
      <dd className="text-sm text-silver-100 sm:text-right">{value}</dd>
    </div>
  );
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
  const [signingOut, setSigningOut] = useState(false);

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
          router.replace("/nexus");
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

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      // The gate greeting caches the member identity locally — clear it so
      // the next visitor starts from the email gate.
      for (const key of ["vx_member_name", "vx_member_title", "vx_member_email"]) {
        window.localStorage.removeItem(key);
      }
      router.replace("/");
    }
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
      <FoundersBackdrop />
      <div className="relative z-10 flex min-h-svh justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-xl">
          <Link
            href="/founders"
            className="micro-label inline-flex items-center gap-2 text-silver-500 transition-colors hover:text-silver-100"
          >
            ← Founders Gate
          </Link>

          {gate !== "ready" ? (
            <p aria-live="polite" className="micro-label mt-16 text-center text-silver-300">
              {gate === "checking" ? "Verifying access…" : "The account page could not load. Refresh to retry."}
            </p>
          ) : account ? (
            <>
              <h1 className="font-display mt-8 text-2xl tracking-[0.1em] text-silver-50">Account</h1>
              <dl className="mt-6 divide-y divide-white/8 border-y border-white/8">
                <Row label="Name" value={account.user.name ?? "—"} />
                <Row label="Alias" value={account.user.alias ?? "—"} />
                <Row label="Email" value={account.user.email} />
                <Row
                  label="Root organization role"
                  value={account.rootMembership.title
                    ? `${account.rootMembership.title} (${account.rootMembership.role})`
                    : account.rootMembership.role}
                />
                {account.applicationRole !== account.rootMembership.role ? (
                  <Row label="Application role" value={account.applicationRole} />
                ) : null}
                <Row label="Current organization" value={currentOrganization?.name ?? account.rootOrganization.name} />
              </dl>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="mt-8 inline-flex items-center gap-2.5 rounded-xl border border-white/12 px-5 py-3 text-sm text-silver-100 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOutIcon size="sm" />
                {signingOut ? "Signing out…" : "Log out"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
