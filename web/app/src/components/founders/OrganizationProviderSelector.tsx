"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CloseIcon } from "@vorinthex/shared/ui/icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";

type CredentialField = {
  key: string;
  label: string;
  type?: "password" | "url" | "text";
  required?: boolean;
};

type ProviderDefinition = {
  id: string;
  name: string;
  credentials: CredentialField[];
};

type ConnectedProvider = ProviderDefinition & {
  connectionName: string;
  description: string;
  createdAt: string;
  tokens: number;
  lastUsed: string | null;
};

const PROVIDER_REGISTRY: ProviderDefinition[] = [
  { id: "openai", name: "OpenAI", credentials: [{ key: "apiKey", label: "api key", type: "password", required: true }, { key: "baseUrl", label: "base url", type: "url" }, { key: "organization", label: "organization" }, { key: "project", label: "project" }] },
  { id: "anthropic", name: "Anthropic", credentials: [{ key: "apiKey", label: "api key", type: "password", required: true }] },
  { id: "xai", name: "xAI", credentials: [{ key: "apiKey", label: "api key", type: "password", required: true }, { key: "baseUrl", label: "base url", type: "url" }] },
  { id: "google-vertex", name: "Google Vertex AI", credentials: [{ key: "apiKey", label: "api key", type: "password" }, { key: "accessToken", label: "access token", type: "password" }, { key: "projectId", label: "project id" }, { key: "location", label: "location" }] },
  { id: "azure-ai-foundry", name: "Azure AI Foundry", credentials: [{ key: "apiKey", label: "api key", type: "password", required: true }, { key: "endpoint", label: "endpoint", type: "url", required: true }, { key: "apiVersion", label: "api version" }] },
  { id: "aws-bedrock", name: "AWS Bedrock", credentials: [{ key: "region", label: "region", required: true }, { key: "accessKeyId", label: "access key id", required: true }, { key: "secretAccessKey", label: "secret access key", type: "password", required: true }, { key: "sessionToken", label: "session token", type: "password" }] },
  { id: "openrouter", name: "OpenRouter", credentials: [{ key: "apiKey", label: "api key", type: "password", required: true }, { key: "baseUrl", label: "base url", type: "url" }, { key: "siteUrl", label: "site url", type: "url" }, { key: "appName", label: "app name" }] },
];

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(tokens);
}

function formatLastUsed(value: string | null): string {
  if (!value) return "never used";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}

function isConnectedProvider(provider: ProviderDefinition | ConnectedProvider): provider is ConnectedProvider {
  return "connectionName" in provider;
}

export function OrganizationProviderSelector({ organizationKey }: { organizationKey: string }) {
  const reducedMotion = useReducedMotion();
  const [providers, setProviders] = useState<ConnectedProvider[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ProviderDefinition | ConnectedProvider | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const [description, setDescription] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  const connectedProviders = useMemo(() => [...providers].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [providers]);
  const isConnected = selected ? isConnectedProvider(selected) : false;

  function openConnect() {
    setSelected(PROVIDER_REGISTRY[0]);
    setConnectionName("");
    setDescription("");
    setCredentials({});
    setOpen(true);
  }

  function openProvider(provider: ConnectedProvider) {
    setSelected(provider);
    setConnectionName(provider.connectionName);
    setDescription(provider.description);
    setCredentials({});
    setOpen(true);
  }

  function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || isConnected || !connectionName.trim()) return;
    if (selected.credentials.some((field) => field.required && !credentials[field.key]?.trim())) return;
    setProviders((current) => [...current, {
      ...selected,
      connectionName: connectionName.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
      tokens: 0,
      lastUsed: null,
    }]);
    setOpen(false);
  }

  return (
    <section className="border-t border-white/8 pt-5" aria-label="Organization providers" data-organization-key={organizationKey}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs text-silver-500">providers</span>
        <span className="font-mono text-[0.58rem] text-silver-500">{connectedProviders.length}</span>
      </div>
      <div className="space-y-1.5">
        <button type="button" onClick={openConnect} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 px-3 py-3 text-left text-sm text-silver-300 transition-colors hover:border-[#d57828]/50 hover:bg-[#d57828]/8 hover:text-silver-50">
          <span className="grid h-6 w-6 place-items-center rounded-full border border-white/15 text-base leading-none">+</span>
          <span>connect provider</span>
        </button>
        {connectedProviders.map((provider) => (
          <button key={provider.createdAt} type="button" onClick={() => openProvider(provider)} className="w-full rounded-xl border border-white/8 px-3 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.035]">
            <span className="block truncate text-sm text-silver-100">{provider.connectionName}</span>
            <span className="mt-0.5 block truncate text-xs text-silver-500">{provider.name}</span>
          </button>
        ))}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && selected ? (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.12 : 0.28 }} />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount>
                <motion.section className="founders-surface fixed inset-x-4 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-auto -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/12 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.7)] outline-none sm:left-1/2 sm:right-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2" initial={reducedMotion ? { opacity: 0 } : { y: "-46%", opacity: 0, scale: 0.98 }} animate={reducedMotion ? { opacity: 1 } : { y: "-50%", opacity: 1, scale: 1 }} exit={reducedMotion ? { opacity: 0 } : { y: "-46%", opacity: 0, scale: 0.98 }} transition={{ duration: reducedMotion ? 0.12 : 0.32, ease: [0.16, 1, 0.3, 1] }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Dialog.Title className="text-lg text-silver-50">{isConnected ? connectionName : "connect provider"}</Dialog.Title>
                      <Dialog.Description className="mt-1 text-sm text-silver-400">{isConnected ? selected.name : "add credentials for this organization"}</Dialog.Description>
                    </div>
                    <Dialog.Close asChild><button type="button" aria-label="Close provider dialog" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-silver-300 transition-colors hover:border-white/25 hover:text-silver-50"><CloseIcon size="sm" /></button></Dialog.Close>
                  </div>

                  {isConnectedProvider(selected) ? (
                    <div className="mt-6 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/8 bg-black/15 p-3"><span className="block text-xs text-silver-500">tokens</span><span className="mt-1 block text-sm text-silver-100">{formatTokens(selected.tokens)}</span></div>
                      <div className="rounded-xl border border-white/8 bg-black/15 p-3"><span className="block text-xs text-silver-500">last used</span><span className="mt-1 block text-sm text-silver-100">{formatLastUsed(selected.lastUsed)}</span></div>
                      {selected.description ? <p className="col-span-2 text-sm leading-relaxed text-silver-300">{selected.description}</p> : null}
                    </div>
                  ) : (
                    <form className="mt-6 space-y-4" onSubmit={connect}>
                      <label className="block"><span className="block text-xs text-silver-500">provider</span><select value={selected.id} onChange={(event) => { const provider = PROVIDER_REGISTRY.find((entry) => entry.id === event.target.value); if (provider) { setSelected(provider); setCredentials({}); } }} className="founders-surface mt-2 w-full rounded-xl px-3 py-2.5 text-sm text-silver-100 outline-none">{PROVIDER_REGISTRY.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
                      <label className="block"><span className="block text-xs text-silver-500">name</span><input required value={connectionName} onChange={(event) => setConnectionName(event.target.value)} className="founders-surface mt-2 w-full rounded-xl px-3 py-2.5 text-sm text-silver-100 outline-none" /></label>
                      <label className="block"><span className="block text-xs text-silver-500">description <span className="text-silver-600">optional</span></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="founders-surface mt-2 w-full resize-none rounded-xl px-3 py-2.5 text-sm text-silver-100 outline-none" /></label>
                      <div className="grid gap-4 sm:grid-cols-2">{selected.credentials.map((field) => <label key={field.key} className="block"><span className="block text-xs text-silver-500">{field.label}{field.required ? "" : <span className="text-silver-600"> optional</span>}</span><input required={field.required} type={field.type ?? "text"} value={credentials[field.key] ?? ""} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} className="founders-surface mt-2 w-full rounded-xl px-3 py-2.5 text-sm text-silver-100 outline-none" /></label>)}</div>
                      <button type="submit" className="w-full rounded-xl border border-[#d57828]/50 bg-[#d57828]/12 px-4 py-3 text-sm text-silver-50 transition-colors hover:bg-[#d57828]/20">connect {selected.name}</button>
                    </form>
                  )}
                </motion.section>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </AnimatePresence>
      </Dialog.Root>
    </section>
  );
}
