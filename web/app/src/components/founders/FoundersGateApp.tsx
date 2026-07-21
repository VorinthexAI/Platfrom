"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon } from "@vorinthex/shared/ui/icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import {
  FoundersRequestError,
  fetchAccessibleOrganizations,
  fetchAccessibleScopes,
  fetchFoundersAccount,
} from "@/lib/founders/client";
import { selectDefaultScope } from "@/lib/founders/scope-selection";
import type { AccessibleOrganizationOption, AccessibleScopeOption, FoundersAccount } from "@/lib/founders/types";
import { useBeaconStream } from "@/lib/founders/use-beacon-stream";
import { BeaconToolActivityFeed } from "./BeaconToolActivityFeed";
import { SafeMarkdown } from "@/lib/founders/markdown";
import { AccountFooter } from "./AccountFooter";
import { ArtifactWorkspace } from "./ArtifactWorkspace";
import { BeaconInputIsland } from "./BeaconInputIsland";
import { ContextSelector } from "./ContextSelector";
import { FoundersBackdrop } from "./FoundersBackdrop";
import { AccountModal } from "./AccountModal";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { getEntityById } from "@/lib/galaxy/registry-helpers";
import { entityAudioUrl, orchestratorMessageUrl, useAudioStore } from "@/lib/audio/audio-store";
import { NexusTransit } from "./NexusTransit";
import { NexusEntityArc } from "./NexusEntityArc";

const OrchestratorHierarchy = dynamic(() => import("./OrchestratorHierarchy"), { ssr: false });
const OrchestratorCommandDeck = dynamic(() => import("./OrchestratorCommandDeck"), { ssr: false });

const ORGANIZATION_STORAGE_KEY = "vx_founders_organization";
const scopeStorageKey = (organizationKey: string) => `vx_founders_scope:${organizationKey}`;

type GateState = "checking" | "ready" | "error";

interface FoundersGateAppProps {
  onUnauthorized?: () => void;
}

/**
 * Founders Gate V1: select an organization, select a scope, ask Beacon,
 * watch the response stream. The interface stays almost empty — the sun
 * texture is the surface, and only the selectors, dropdowns, and the input
 * island carry contained obsidian surfaces. The backend independently
 * enforces every access rule; this guard is presentation only.
 */
export function FoundersGateApp({ onUnauthorized }: FoundersGateAppProps) {
  const reducedMotion = useReducedMotion();
  const [gate, setGate] = useState<GateState>("checking");
  const [account, setAccount] = useState<FoundersAccount | null>(null);
  const [organizations, setOrganizations] = useState<AccessibleOrganizationOption[]>([]);
  const [organizationKey, setOrganizationKey] = useState<string | null>(null);
  const [scopes, setScopes] = useState<AccessibleScopeOption[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [artifactSheetOpen, setArtifactSheetOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState("product.core");
  const [enteredEntityId, setEnteredEntityId] = useState<string | null>(null);
  const [transitDestination, setTransitDestination] = useState<string | null>("Nexus command station");
  const scopeRequestRef = useRef(0);

  const beacon = useBeaconStream();
  const { reset: resetBeacon, cancel: cancelBeacon } = beacon;
  const playVoice = useAudioStore((state) => state.playVoice);
  const stopVoice = useAudioStore((state) => state.stopVoice);
  const startAmbient = useAudioStore((state) => state.startAmbient);
  const ambientStarted = useAudioStore((state) => state.ambientStarted);

  useEffect(() => {
    // Try autoplay first; browsers that block it are released by the first
    // interaction, matching the landing page's ambient soundtrack behavior.
    startAmbient();
    if (ambientStarted) return;
    const release = () => startAmbient();
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const event of events) window.addEventListener(event, release, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, release);
    };
  }, [ambientStarted, startAmbient]);

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
        // Keep these sequential: when a 15-minute access token has just
        // expired, the first request rotates the single-use refresh token
        // and returns the new cookie pair before the second request starts.
        const loadedAccount = await fetchFoundersAccount();
        const loadedOrganizations = await fetchAccessibleOrganizations();
        if (cancelled) return;
        setAccount(loadedAccount);
        setOrganizations(loadedOrganizations);
        const assignedEntity = loadedAccount.rootMembership.orchestrator
          ? getEntityById(`orchestrator.${loadedAccount.rootMembership.orchestrator.slug}`)
          : null;
        if (assignedEntity?.type === "orchestrator") {
          setSelectedEntityId(assignedEntity.id);
          setEnteredEntityId(assignedEntity.id);
          setTransitDestination(`Entering ${assignedEntity.name} deck`);
        }
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
          if (onUnauthorized) {
            onUnauthorized();
            return;
          }
          // Not an authenticated root member — back to the gate itself.
          window.location.replace("/nexus");
          return;
        }
        setGate("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadScopes, onUnauthorized]);

  const changeOrganization = useCallback((nextKey: string) => {
    cancelBeacon();
    resetBeacon();
    setArtifactSheetOpen(false);
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, nextKey);
    setOrganizationKey(nextKey);
    void loadScopes(nextKey);
  }, [cancelBeacon, resetBeacon, loadScopes]);

  const changeScope = useCallback((nextKey: string) => {
    if (organizationKey) window.localStorage.setItem(scopeStorageKey(organizationKey), nextKey);
    setArtifactSheetOpen(false);
    setScopeKey(nextKey);
  }, [organizationKey]);

  const scopeOptions = useMemo(() => scopes.map((scope) => ({
    key: scope.key,
    name: scope.name,
  })), [scopes]);

  const organizationOptions = useMemo(() => organizations.map((organization) => ({
    key: organization.key,
    name: organization.name,
    hint: organization.alias,
  })), [organizations]);

  const beaconDisabled = !organizationKey || !scopeKey;
  const selectedEntity = getEntityById(selectedEntityId) ?? VORINTHEX_GALAXY_REGISTRY.products.core;
  const enteredEntity = enteredEntityId
    ? getEntityById(enteredEntityId) ?? null
    : null;
  const hasBeaconOutput = Boolean(beacon.response || beacon.error || beacon.tools.length > 0);
  const activeDelegation = beacon.tools.at(-1) ?? null;

  const submit = useCallback((message: string) => {
    if (!organizationKey || !scopeKey) return;
    void beacon.ask({ organizationKey, scopeKey, message });
  }, [beacon, organizationKey, scopeKey]);

  const enterEntity = useCallback((entity: GalaxyEntity) => {
    cancelBeacon();
    resetBeacon();
    stopVoice();
    setSelectedEntityId(entity.id);
    setEnteredEntityId(entity.id);
    setTransitDestination(`Entering ${entity.name} deck`);
  }, [cancelBeacon, resetBeacon, stopVoice]);

  const leaveEntity = useCallback(() => {
    cancelBeacon();
    resetBeacon();
    stopVoice();
    setEnteredEntityId(null);
  }, [cancelBeacon, resetBeacon, stopVoice]);

  const completeTransit = useCallback(() => setTransitDestination(null), []);

  useEffect(() => () => stopVoice(), [stopVoice]);

  if (gate !== "ready") {
    return (
      <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
        <FoundersBackdrop />
        <div className="relative z-10 flex min-h-svh items-center justify-center">
          {gate === "checking" ? <div aria-busy="true" /> : (
            <p aria-live="polite" className="micro-label text-silver-300">
              Nexus could not load. Refresh to retry.
            </p>
          )}
        </div>
      </main>
    );
  }

  const panel = (
    <>
      <div className="space-y-5">
        <ContextSelector
          label="Organization"
          placeholder="Select organization"
          value={organizationKey}
          options={organizationOptions}
          onChange={changeOrganization}
        />
        <ContextSelector
          label="Scope"
          placeholder={scopesLoading ? "Loading scopes…" : "Select scope"}
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
          onOpen={() => { setDrawerOpen(false); setAccountOpen(true); }}
        />
      ) : null}
    </>
  );

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#1c0701]">
      <FoundersBackdrop />

      <div className="relative z-10 flex h-svh">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute inset-0">
              {enteredEntity ? (
                <OrchestratorCommandDeck entity={enteredEntity} reducedMotion={Boolean(reducedMotion)} />
              ) : (
                <div className="mx-auto h-full min-h-[670px] max-w-[1540px] px-4 pt-2 pb-24 sm:px-8 lg:pt-4">
                <OrchestratorHierarchy
                  selectedId={selectedEntity.id}
                  onSelect={(entity) => setSelectedEntityId(entity.id)}
                  onEnter={enterEntity}
                  delegation={activeDelegation}
                  muted={false}
                />
                </div>
              )}
            </div>

            {!enteredEntity ? <NexusEntityArc selectedEntityId={selectedEntity.id} onSelect={(entity) => setSelectedEntityId(entity.id)} onEnter={enterEntity} /> : null}

            {enteredEntity ? (
              <div className="scrollbar-hide pointer-events-none relative z-10 h-full overflow-y-auto px-4 sm:px-8">
                <div className="mx-auto w-full max-w-[820px] pt-24 pb-64 sm:pt-28">
                  {hasBeaconOutput ? (
                  <article className="pointer-events-auto" aria-live="polite" aria-busy={beacon.status === "streaming" || beacon.status === "connecting"}>
                    <BeaconToolActivityFeed tools={beacon.tools} status={beacon.status} />
                    {beacon.response ? <SafeMarkdown markdown={beacon.response} /> : null}
                    {beacon.error ? <p className="text-base leading-relaxed text-silver-100">{beacon.error}</p> : null}
                    {beacon.status === "streaming" || beacon.status === "connecting" ? (
                      <span aria-hidden className="mt-1 ml-0.5 inline-block h-4 w-[2px] bg-silver-100 motion-safe:animate-pulse" />
                    ) : null}
                  </article>
                ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {enteredEntity ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 px-4 sm:px-8">
            <div className="pointer-events-auto mx-auto w-full max-w-[820px]">
              <BeaconInputIsland
                status={beacon.status}
                disabled={beaconDisabled}
                assistantName={enteredEntity.name}
                onSubmit={submit}
                onCancel={cancelBeacon}
              />
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => playVoice(entityAudioUrl(enteredEntity.type, enteredEntity.slug))} className="founders-surface inline-flex items-center rounded-full px-4 py-2 font-mono text-[0.58rem] tracking-[0.16em] text-silver-200 uppercase transition-colors hover:border-white/25 hover:text-white">
                  Play Briefing
                </button>
                {enteredEntity.type === "orchestrator" ? (
                  <button type="button" onClick={() => playVoice(orchestratorMessageUrl(enteredEntity.slug))} className="founders-surface inline-flex items-center rounded-full px-4 py-2 font-mono text-[0.58rem] tracking-[0.16em] text-silver-200 uppercase transition-colors hover:border-white/25 hover:text-white">
                    Meet {enteredEntity.name}
                  </button>
                ) : null}
                <button type="button" onClick={leaveEntity} className="founders-surface inline-flex items-center rounded-full px-4 py-2 font-mono text-[0.58rem] tracking-[0.16em] text-silver-200 uppercase transition-colors hover:border-white/25 hover:text-white">
                  Exit
                </button>
              </div>
            </div>
          </div>
          ) : null}
        </section>
      </div>

      <AnimatePresence>
        {transitDestination ? <NexusTransit key={transitDestination} destination={transitDestination} reducedMotion={Boolean(reducedMotion)} onComplete={completeTransit} /> : null}
      </AnimatePresence>

      {organizationKey && scopeKey ? (
        <ArtifactWorkspace
          key={`${organizationKey}:${scopeKey}`}
          organizationKey={organizationKey}
          scopeKey={scopeKey}
          open={artifactSheetOpen}
          onOpenChange={setArtifactSheetOpen}
        />
      ) : null}

      {account && organizationKey ? (
        <AccountModal
          account={account}
          organization={organizations.find((organization) => organization.key === organizationKey) ?? null}
          open={accountOpen}
          onOpenChange={setAccountOpen}
          onSignedOut={() => {
            setAccountOpen(false);
            if (onUnauthorized) onUnauthorized();
            else window.location.replace("/nexus");
          }}
          canManageProviders={organizations.find((organization) => organization.key === organizationKey)?.role === "owner"}
        />
      ) : null}

      <AnimatePresence>
        {drawerOpen ? (
          <motion.div
            className="fixed inset-0 z-30"
            role="dialog"
            aria-modal="true"
            aria-label="Organization and scope panel"
            initial="closed"
            animate="open"
            exit="closed"
            variants={{ open: { transition: { staggerChildren: reducedMotion ? 0 : 0.03 } }, closed: { transition: { staggerChildren: reducedMotion ? 0 : 0.02, staggerDirection: -1 } } }}
          >
          <motion.button
            type="button"
            aria-label="Close panel"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/55"
            variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }}
            transition={{ duration: reducedMotion ? 0.12 : 0.3, ease: "easeOut" }}
          />
          <motion.div
            className="founders-surface absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col rounded-r-2xl p-5 shadow-[24px_0_80px_rgba(0,0,0,0.45)]"
            variants={reducedMotion ? { open: { opacity: 1 }, closed: { opacity: 0 } } : { open: { x: 0, opacity: 1 }, closed: { x: "-105%", opacity: 0.9 } }}
            transition={reducedMotion ? { duration: 0.12 } : { duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
          >
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
          </motion.div>
        </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
