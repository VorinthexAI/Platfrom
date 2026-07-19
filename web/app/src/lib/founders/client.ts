import type { AccessibleOrganizationOption, AccessibleScopeOption, Artifact, ArtifactNodeDetails, FoundersAccount, OrganizationProvider, ResolvedArtifact, SceneNodeRef } from "./types";

/**
 * Browser-side fetchers for the Founders Gate route handlers. Everything
 * goes through same-origin `/api/founders/*`; the session rides on the
 * httpOnly cookie and the backend re-authorizes every call.
 */

export class FoundersRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "FoundersRequestError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new FoundersRequestError(response.status, `request to ${path} failed`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new FoundersRequestError(response.status, `request to ${path} failed`);
  return (await response.json()) as T;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new FoundersRequestError(response.status, `request to ${path} failed`);
  return (await response.json()) as T;
}

export function fetchFoundersAccount(): Promise<FoundersAccount> {
  return getJson<FoundersAccount>("/api/founders/me");
}

export async function fetchAccessibleOrganizations(): Promise<AccessibleOrganizationOption[]> {
  const payload = await getJson<{ organizations: AccessibleOrganizationOption[] }>("/api/founders/organizations");
  return payload.organizations ?? [];
}

export async function fetchAccessibleScopes(organizationKey: string): Promise<AccessibleScopeOption[]> {
  const payload = await getJson<{ scopes: AccessibleScopeOption[] }>(
    `/api/founders/organizations/${encodeURIComponent(organizationKey)}/scopes`,
  );
  return payload.scopes ?? [];
}

export async function fetchOrganizationProviders(organizationKey: string): Promise<OrganizationProvider[]> {
  const payload = await getJson<{ providers: OrganizationProvider[] }>(
    `/api/founders/organizations/${encodeURIComponent(organizationKey)}/providers`,
  );
  return payload.providers ?? [];
}

export function updateOrganizationProviderCredentials(
  organizationKey: string,
  providerSlug: string,
  credentials: Record<string, string>,
): Promise<OrganizationProvider> {
  return putJson(
    `/api/founders/organizations/${encodeURIComponent(organizationKey)}/providers/${encodeURIComponent(providerSlug)}/credentials`,
    { credentials },
  );
}

export async function fetchArtifacts(organizationKey: string, scopeKey: string): Promise<Artifact[]> {
  const query = new URLSearchParams({ organizationKey, scopeKey });
  const payload = await getJson<{ artifacts: Artifact[] }>(`/api/founders/artifacts?${query}`);
  return payload.artifacts ?? [];
}

export function resolveArtifact(artifactKey: string, organizationKey: string, scopeKey: string): Promise<ResolvedArtifact> {
  return postJson(`/api/founders/artifacts/${encodeURIComponent(artifactKey)}/resolve`, { organizationKey, scopeKey });
}

export function readArtifactNode(artifactKey: string, organizationKey: string, scopeKey: string, ref: SceneNodeRef): Promise<ArtifactNodeDetails> {
  return postJson(`/api/founders/artifacts/${encodeURIComponent(artifactKey)}/nodes/read`, { organizationKey, scopeKey, ref: { type: ref.nodeType, key: ref.nodeKey } });
}
