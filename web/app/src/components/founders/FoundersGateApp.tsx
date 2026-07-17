"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloseIcon, MenuIcon } from "@vorinthex/shared/ui/icons";
import {
  FoundersRequestError,
  fetchAccessibleOrganizations,
  fetchAccessibleScopes,
  fetchFoundersAccount,
} from "@/lib/founders/client";
import { selectDefaultScope } from "@/lib/founders/scope-selection";
import type { AccessibleOrganizationOption, AccessibleScopeOption, FoundersAccount } from "@/lib/founders/types";
import { useBeaconStream } from "@/lib/founders/use-beacon-stream";
import { SafeMarkdown } from "@/lib/founders/markdown";
import { AccountFooter } from "./AccountFooter";
import { BeaconInputIsland } from "./BeaconInputIsland";
import { ContextSelector } from "./ContextSelector";
import { FoundersBackdrop } from "./FoundersBackdrop";

const ORGANIZATION_STORAGE_KEY = "vx_founders_organization";
const scopeStorageKey = (organizationKey: string) => `vx_founders_scope:${organizationKey}`;

type GateState = "checking" | "ready" | "error";

/**
 * Founders Gate V1: select an organization, select a scope, ask Beacon,
 * watch the response stream. The interface stays almost empty — the sun
 * texture is the surface, and only the selectors, dropdowns, and the input
 * island carry contained obsidian surfaces. The backend independently
 * enforces every access rule; this guard is presentation only.
 */
export function FoundersGateApp() {
  const router = useRouter();
  const [gate, setGate] = useState<GateState>("checking");
  const [account, setAccount] = useState<FoundersAccount | null>(null);
  const [organizations, setOrganizations] = useState<AccessibleOrganizationOption[]>([]);
  const [organizationKey, setOrganizationKey] = useState<string | null>(null);
  const [scopes, setScopes] = useState<AccessibleScopeOption[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scopeRequestRef = useRef(0);

  const beacon = useBeaconStream();
  const { reset: resetBeacon, cancel: cancelBeacon } = beacon;

  const loadScopes = useCallback(async (nextOrganizationKey: string) => {
    const requestId = scopeRequestRef.current + 1;
    scopeRequestRef.current = requestId;
    setScopesLoading(true);
    setScopes([]);
    setScopeKey(null);
    try {
      const loaded = await fetchAccessibleScopes(nextOrganizationKey);
      if (scopeRequestRef.current !== requestId) return;
      setScopes(loaded);
      const stored = window.localStorage.getItem(scopeStorageKey(nextOrganizationKey));
      setScopeKey(selectDefaultScope(loaded, stored));
    } catch {
      if (scopeRequestRef.current !== requestId) return;
      setScopes([]);
      setScopeKey(null);
    } finally {
      if (scopeRequestRef.current === requestId) setScopesLoading(false);
    }
  }, []);

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
        const stored = window.localStorage.getItem(ORGANIZATION_STORAGE_KEY);
        const initialKey = loadedOrganizations.find((organization) => organization.key === stored)?.key
          ?? loadedOrganizations[0]?.key
          ?? null;
        setOrganizationKey(initialKey);
        setGate("ready");
        if (initialKey) void loadScopes(initialKey);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof FoundersRequestError && (error.status === 401 || error.status === 403)) {
          // Not an authenticated root member — back to the gate itself.
          router.replace("/nexus");
          return;
        }
        setGate("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadScopes]);

  const changeOrganization = useCallback((nextKey: string) => {
    cancelBeacon();
    resetBeacon();
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, nextKey);
    setOrganizationKey(nextKey);
    void loadScopes(nextKey);
  }, [cancelBeacon, resetBeacon, loadScopes]);

  const changeScope = useCallback((nextKey: string) => {
    if (organizationKey) window.localStorage.setItem(scopeStorageKey(organizationKey), nextKey);
    setScopeKey(nextKey);
  }, [organizationKey]);

  const scopeOptions = useMemo(() => scopes.map((scope) => ({
    key: scope.key,
    name: scope.name,
    hint: scope.path.length > 1 ? scope.path.slice(0, -1).join(" / ") : null,
    depth: Math.max(0, scope.path.length - 1),
  })), [scopes]);

  const organizationOptions = useMemo(() => organizations.map((organization) => ({
    key: organization.key,
    name: organization.name,
    hint: organization.alias,
  })), [organizations]);

  const disabledReason = organizations.length === 0
    ? "No accessible organizations."
    : !scopesLoading && scopes.length === 0
      ? "No accessible scopes in this organization."
      : scopesLoading
        ? "Loading scopes…"
        : null;
  const beaconDisabled = !organizationKey || !scopeKey;

  const submit = useCallback((message: string) => {
    if (!organizationKey || !scopeKey) return;
    void beacon.ask({ organizationKey, scopeKey, message });
  }, [beacon, organizationKey, scopeKey]);

  if (gate !== "ready") {
    return (
      <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
        <FoundersBackdrop />
        <div className="relative z-10 flex min-h-svh items-center justify-center">
          <p aria-live="polite" className="micro-label text-silver-300">
            {gate === "checking" ? "Verifying access…" : "Founders Gate could not load. Refresh to retry."}
          </p>
        </div>
      </main>
    );
  }

  const panel = (
    <>
      <div className="space-y-5">
        <ContextSelector
          label="Organization"
          placeholder={organizations.length === 0 ? "No accessible organizations." : "Select organization"}
          value={organizationKey}
          options={organizationOptions}
          onChange={changeOrganization}
        />
        <ContextSelector
          label="Scope"
          placeholder={scopesLoading ? "Loading scopes…" : scopes.length === 0 ? "No accessible scopes in this organization." : "Select scope"}
          value={scopeKey}
          options={scopeOptions}
          onChange={changeScope}
          disabled={!organizationKey}
        />
      </div>
      <div className="flex-1" />
      {account ? (
        <AccountFooter
          name={account.user.name ?? account.user.alias ?? account.user.email}
          secondary={account.rootMembership.title ?? account.rootMembership.role}
        />
      ) : null}
    </>
  );

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
      <FoundersBackdrop />

      <div className="relative z-10 flex h-svh">
        {/* Desktop left panel: transparent, divider only. */}
        <aside className="hidden w-[280px] shrink-0 flex-col p-5 lg:flex" style={{ borderRight: "1px solid rgba(221, 226, 229, 0.08)" }}>
          {panel}
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col">
          {/* Mobile context bar: current organization and scope stay visible. */}
          <div className="flex items-center gap-3 px-4 pt-4 lg:hidden">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open organization and scope panel"
              className="founders-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-silver-100"
            >
              <MenuIcon size="sm" />
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="founders-surface min-w-0 flex-1 rounded-xl px-4 py-2 text-left"
            >
              <span className="block truncate text-xs text-silver-100">
                {organizations.find((organization) => organization.key === organizationKey)?.name ?? "No organization"}
              </span>
              <span className="block truncate font-mono text-[0.58rem] tracking-[0.18em] text-silver-500 uppercase">
                {scopes.find((scope) => scope.key === scopeKey)?.name ?? "No scope"}
              </span>
            </button>
          </div>

          {/* The response canvas: one document, no bubbles, no history. */}
          <div className="scrollbar-hide flex-1 overflow-y-auto px-4 sm:px-8">
            <div className="mx-auto w-full max-w-[820px] pt-10 pb-56 sm:pt-16">
              {beacon.response ? (
                <article aria-live="polite" aria-busy={beacon.status === "streaming"}>
                  <SafeMarkdown markdown={beacon.response} />
                  {beacon.status === "streaming" || beacon.status === "connecting" ? (
                    <span aria-hidden className="mt-1 ml-0.5 inline-block h-4 w-[2px] bg-silver-100 motion-safe:animate-pulse" />
                  ) : null}
                </article>
              ) : (
                <div className="flex min-h-[40svh] flex-col items-center justify-center text-center">
                  <h1 className="font-display text-2xl tracking-[0.12em] text-silver-50">Ask Beacon</h1>
                  <p className="mt-3 text-sm text-silver-300">Your gateway to the right intelligence.</p>
                </div>
              )}
            </div>
          </div>

          {/* Floating input island — near the bottom, never attached to it. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-7 px-4 sm:px-8">
            <div className="pointer-events-auto mx-auto w-full max-w-[820px]">
              <BeaconInputIsland
                status={beacon.status}
                error={beacon.error}
                disabled={beaconDisabled}
                disabledReason={disabledReason}
                onSubmit={submit}
                onCancel={cancelBeacon}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Mobile drawer: the left panel slides in over a dimmed veil. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Organization and scope panel">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/55"
          />
          <div className="founders-surface absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col rounded-r-2xl p-5">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close panel"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-silver-300 transition-colors hover:border-white/25 hover:text-silver-50"
              >
                <CloseIcon size="sm" />
              </button>
            </div>
            {panel}
          </div>
        </div>
      ) : null}
    </main>
  );
}
