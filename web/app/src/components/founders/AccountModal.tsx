"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectViewport } from "@vorinthex/shared/ui/components";
import { CloseIcon } from "@vorinthex/shared/ui/icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { fetchOrganizationProviders, updateOrganizationProviderCredentials } from "@/lib/founders/client";
import { signOut } from "@/lib/auth/sign-out";
import type { AccessibleOrganizationOption, FoundersAccount, OrganizationProvider } from "@/lib/founders/types";

type CredentialField = { key: string; label: string; type?: "password" | "url" | "text"; required?: boolean };
type ProviderDefinition = { slug: string; name: string; credentials: CredentialField[] };

const PROVIDERS: ProviderDefinition[] = [
  { slug: "openai", name: "OpenAI", credentials: [{ key: "apiKey", label: "API Key", type: "password", required: true }, { key: "baseUrl", label: "Base URL", type: "url" }, { key: "organization", label: "Organization" }, { key: "project", label: "Project" }] },
  { slug: "anthropic", name: "Anthropic", credentials: [{ key: "apiKey", label: "API Key", type: "password", required: true }] },
  { slug: "xai", name: "xAI", credentials: [{ key: "apiKey", label: "API Key", type: "password", required: true }, { key: "baseUrl", label: "Base URL", type: "url" }] },
  { slug: "google-vertex", name: "Google Vertex AI", credentials: [{ key: "apiKey", label: "API Key", type: "password" }, { key: "accessToken", label: "Access Token", type: "password" }, { key: "projectId", label: "Project ID" }, { key: "location", label: "Location" }] },
  { slug: "azure-ai-foundry", name: "Azure AI Foundry", credentials: [{ key: "apiKey", label: "API Key", type: "password", required: true }, { key: "endpoint", label: "Endpoint", type: "url", required: true }, { key: "apiVersion", label: "API Version" }] },
  { slug: "aws-bedrock", name: "AWS Bedrock", credentials: [{ key: "region", label: "Region", required: true }, { key: "accessKeyId", label: "Access Key ID", required: true }, { key: "secretAccessKey", label: "Secret Access Key", type: "password", required: true }] },
  { slug: "openrouter", name: "OpenRouter", credentials: [{ key: "apiKey", label: "API Key", type: "password", required: true }, { key: "baseUrl", label: "Base URL", type: "url" }, { key: "siteUrl", label: "Site URL", type: "url" }, { key: "appName", label: "App Name" }] },
];

function displayRole(title: string | null, role: string): string {
  return title?.trim().split(/\s+/).at(-1) || `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

export function AccountModal({ account, organization, open, onOpenChange, onSignedOut, canManageProviders }: {
  account: FoundersAccount;
  organization: AccessibleOrganizationOption | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSignedOut(): void;
  canManageProviders: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [providers, setProviders] = useState<OrganizationProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerSlug, setProviderSlug] = useState(PROVIDERS[0].slug);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const selected = PROVIDERS.find((provider) => provider.slug === providerSlug) ?? PROVIDERS[0];

  useEffect(() => {
    if (!open || !canManageProviders || !organization) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchOrganizationProviders(organization.key);
        if (!cancelled) setProviders(rows);
      } catch {
        if (!cancelled) setError("Providers could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [canManageProviders, open, organization]);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || selected.credentials.some((field) => field.required && !credentials[field.key]?.trim())) return;
    setSaving(true);
    setError(null);
    try {
      const values = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
      await updateOrganizationProviderCredentials(organization.key, selected.slug, values);
      setCredentials({});
      setProviders(await fetchOrganizationProviders(organization.key));
    } catch {
      setError("Provider credentials could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    const signedOut = await signOut();
    if (!signedOut) {
      setError("Sign out could not be completed. Try again.");
      setSigningOut(false);
      return;
    }
    onSignedOut();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? <Dialog.Portal forceMount>
          <Dialog.Overlay asChild forceMount><motion.div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.12 : 0.28 }} /></Dialog.Overlay>
          <Dialog.Content asChild forceMount>
            <motion.section className="fixed inset-x-2 top-2 bottom-2 z-50 flex flex-col overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#090b0d] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.7)] outline-none sm:inset-x-4 sm:top-4 sm:bottom-4 sm:p-6 lg:right-5 lg:left-[300px]" initial={reducedMotion ? { opacity: 0 } : { y: "-105%", opacity: 0.7, scale: 0.985 }} animate={reducedMotion ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }} exit={reducedMotion ? { opacity: 0 } : { y: "-105%", opacity: 0.6, scale: 0.985 }} transition={reducedMotion ? { duration: 0.15 } : { duration: 0.62, ease: [0.16, 1, 0.3, 1] }}>
              <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-5">
                <div><Dialog.Title className="text-lg text-silver-50">Account</Dialog.Title><Dialog.Description className="mt-1 text-sm text-silver-400">Identity and organization settings.</Dialog.Description></div>
                <Dialog.Close asChild><button type="button" aria-label="Close Account" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-silver-300 transition-colors hover:border-white/25 hover:text-silver-50"><CloseIcon size="sm" /></button></Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <dl className="divide-y divide-white/8"><AccountRow label="Name" value={account.user.name ?? "-"} /><AccountRow label="Alias" value={account.user.alias ?? "-"} /><AccountRow label="Email" value={account.user.email} /><AccountRow label="Role" value={displayRole(account.rootMembership.title, account.rootMembership.role)} /><AccountRow label="Organization" value={organization?.name ?? account.rootOrganization.name} /></dl>
              {canManageProviders && organization ? <section className="mt-6 border-t border-white/8 pt-6" aria-label="Provider Management"><h2 className="text-base text-silver-50">Provider Management</h2><p className="mt-1 text-sm text-silver-400">Connect credentials for {organization.name}.</p>{loading ? <p className="mt-4 text-sm text-silver-400">Loading Providers...</p> : <><div className="mt-4 flex flex-wrap gap-2">{providers.filter((provider) => provider.linked && provider.credentialsConfigured).map((provider) => <span key={provider.provider} className="rounded-full border border-white/10 px-3 py-1 text-xs text-silver-300">{PROVIDERS.find((definition) => definition.slug === provider.provider)?.name ?? provider.provider}</span>)}</div><form className="mt-5 space-y-4" onSubmit={connect}><label className="block"><span className="block text-xs text-silver-500">Provider</span><Select value={selected.slug} onValueChange={(slug) => { setProviderSlug(slug); setCredentials({}); }}><SelectTrigger aria-label="Provider" className="founders-surface mt-2 w-full rounded-xl px-4 py-3 text-left text-sm text-silver-100"><SelectValue /></SelectTrigger><SelectContent position="popper" sideOffset={8} className="founders-surface z-[60] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl"><SelectViewport className="p-1.5">{PROVIDERS.map((provider) => <SelectItem key={provider.slug} value={provider.slug} className="rounded-lg text-sm text-silver-300 data-[highlighted]:bg-white/8 data-[highlighted]:text-silver-50">{provider.name}</SelectItem>)}</SelectViewport></SelectContent></Select></label><div className="grid gap-4 sm:grid-cols-2">{selected.credentials.map((field) => <label key={field.key} className="block"><span className="block text-xs text-silver-500">{field.label}{field.required ? "" : <span className="text-silver-600"> Optional</span>}</span><input required={field.required} type={field.type ?? "text"} value={credentials[field.key] ?? ""} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} className="founders-surface mt-2 w-full rounded-xl px-3 py-2.5 text-sm text-silver-100 outline-none" /></label>)}</div><Button type="submit" variant="primary" disabled={saving}>{saving ? "Connecting..." : "Connect"}</Button></form></>}{error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}</section> : null}
              </div>
              <footer className="mt-6 border-t border-white/8 pt-6">
                <Button type="button" variant="secondary" disabled={signingOut} onClick={() => void handleSignOut()} className="min-h-0 px-4 py-2.5 text-[0.65rem] whitespace-nowrap">{signingOut ? "Signing out..." : "Sign out"}</Button>
              </footer>
            </motion.section>
          </Dialog.Content>
        </Dialog.Portal> : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between"><dt className="text-sm text-silver-500">{label}</dt><dd className="text-sm text-silver-100 sm:text-right">{value}</dd></div>;
}
