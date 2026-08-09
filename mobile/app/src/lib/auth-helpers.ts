export type AuthUser = {
  key?: string;
  email?: string;
  name?: string;
  firstName?: string;
  alias?: string;
  isOnboarded: boolean;
};

export type AuthContext = {
  user: AuthUser | null;
  organization: Record<string, unknown> | null;
  scope: Record<string, unknown> | null;
  contentExecution: { agentKey: string } | null;
};

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function stringValue(source: UnknownRecord | null, ...keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function numberValue(source: UnknownRecord | null, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function booleanValue(source: UnknownRecord | null, ...keys: string[]) {
  for (const key of keys) {
    if (typeof source?.[key] === "boolean") return source[key] as boolean;
  }
  return false;
}

export function normalizeApiPath(path: string) {
  const withoutOrigin = path.replace(/^https?:\/\/[^/]+/i, "");
  return `/${withoutOrigin.replace(/^\/?(?:api\/v1\/)?/, "")}`;
}

export function extractSessionTokens(
  data: unknown,
  header: (name: string) => string | null | undefined,
  now = Date.now(),
): SessionTokens | null {
  const body = record(data);
  const accessToken = header("x-access-token") ?? stringValue(body, "access_token", "accessToken");
  const refreshToken = header("x-refresh-token") ?? stringValue(body, "refresh_token", "refreshToken");
  const accessMaxAge = Number(header("x-access-token-max-age")) ||
    numberValue(body, "access_token_max_age_seconds", "accessTokenMaxAgeSeconds");
  const refreshMaxAge = Number(header("x-refresh-token-max-age")) ||
    numberValue(body, "refresh_token_max_age_seconds", "refreshTokenMaxAgeSeconds");

  if (!accessToken || !refreshToken || !accessMaxAge || !refreshMaxAge) return null;
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: now + accessMaxAge * 1_000,
    refreshExpiresAt: now + refreshMaxAge * 1_000,
  };
}

export function normalizeAuthContext(value: unknown): AuthContext {
  const body = record(value);
  const rawUser = record(body?.user) ?? record(body?.identity);
  const user = rawUser ? {
    ...rawUser,
    email: stringValue(rawUser, "email"),
    name: stringValue(rawUser, "name", "display_name"),
    firstName: stringValue(rawUser, "firstName", "first_name"),
    alias: stringValue(rawUser, "alias"),
    isOnboarded: booleanValue(rawUser, "isOnboarded", "is_onboarded"),
  } : null;
  return {
    user,
    organization: record(body?.organization) ?? record(body?.org),
    scope: record(body?.scope) ?? record(body?.main_scope),
    contentExecution: (() => {
      const execution = record(body?.contentExecution) ?? record(body?.content_execution);
      const agentKey = stringValue(execution, "agentKey", "agent_key");
      return agentKey ? { agentKey } : null;
    })(),
  };
}

export function firstNameFor(user: AuthUser | null) {
  const candidate = user?.firstName ?? user?.name ?? user?.alias ?? user?.email?.split("@")[0];
  return candidate?.trim().split(/\s+/)[0] || "there";
}
