// src/app/console/settings/page.tsx
//
// Account settings page (neural-map.md §59.1) — renders inside the console
// shell's dark theme (owned by the console-shell agent; CSS variables
// referenced below — --vx-console-bg/-surface/-text/-text-muted/-accent/
// -border — are trusted to exist by the time this runs, per this repo's
// current cross-agent build plan).
//
// Server Component: reads the authoritative session via `verifySession()`
// (src/server/dal/session.ts, owned by the auth agent, in flight alongside
// this file — coded here against its pinned signature/shape only:
// `Session = { userId, displayName, avatarUrl, mfaLevel: "totp" }`).

import { verifySession } from "@/server/dal/session";
import { Avatar, Badge, Card, DataGrid, TotpSetup } from "@vorinthex/shared/ui";

export const metadata = {
  title: "Settings — Vorinthex Console",
};

type ReenrollmentFactor = {
  otpauthUri: string;
  qrCodeImageSrc: string;
  accountLabel: string;
  issuerLabel: string;
};

/**
 * Fetches a fresh TOTP re-enrollment factor from the auth backend (mock or
 * real — both implement `POST /api/v1/auth/signup`, §45). This page talks
 * to the backend directly rather than through a Next.js proxy route handler
 * because no such route exists yet at the time of writing (§17.5's proxy
 * layer is out of this file's scope) — swap this for the real proxied
 * endpoint once it lands, without changing anything else on this page.
 */
async function fetchReenrollmentFactor(accountLabel: string): Promise<ReenrollmentFactor | null> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountLabel }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | Partial<ReenrollmentFactor>
      | null;
    if (
      !data?.otpauthUri ||
      !data.qrCodeImageSrc ||
      !data.accountLabel ||
      !data.issuerLabel
    ) {
      return null;
    }
    return {
      accountLabel: data.accountLabel,
      issuerLabel: data.issuerLabel,
      otpauthUri: data.otpauthUri,
      qrCodeImageSrc: data.qrCodeImageSrc,
    };
  } catch {
    // Backend/mock server unreachable — degrade gracefully rather than
    // crashing the whole settings page over an optional re-enrollment card.
    return null;
  }
}

const textStyle = { color: "var(--vx-console-text)" };
const mutedStyle = { color: "var(--vx-console-text-muted)" };
const cardBodyStyle = {
  padding: "1.25rem 1.5rem",
  display: "grid",
  gap: "0.75rem",
} as const;

export default async function SettingsPage() {
  const session = await verifySession();
  const reenrollment = await fetchReenrollmentFactor(session.userId);

  return (
    <div style={{ display: "grid", gap: "1.5rem", maxWidth: 760, padding: "2rem 1.5rem" }}>
      <header style={{ display: "grid", gap: "0.25rem" }}>
        <h1 style={{ ...textStyle, fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Settings</h1>
        <p style={{ ...mutedStyle, margin: 0 }}>
          Manage your account, two-factor authentication, and active sessions.
        </p>
      </header>

      {/* Account info */}
      <Card style={{ background: "var(--vx-console-surface)", border: "1px solid var(--vx-console-border)", borderRadius: 12 }}>
        <div style={cardBodyStyle}>
          <h2 style={{ ...textStyle, fontSize: "1.05rem", margin: 0 }}>Account</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Avatar
              alt={session.displayName}
              fallback={session.displayName.slice(0, 2).toUpperCase()}
              src={session.avatarUrl ?? undefined}
            />
            <div style={{ display: "grid", gap: "0.15rem" }}>
              <span style={{ ...textStyle, fontWeight: 500 }}>{session.displayName}</span>
              {/* `Session` (§21) has no dedicated `email` field — `userId` is
                  the account identifier the mock/real auth backend derives
                  from the login email, so it's shown here as the account's
                  email/identifier. */}
              <span style={mutedStyle}>{session.userId}</span>
            </div>
            <Badge style={{ marginLeft: "auto" }}>{session.mfaLevel.toUpperCase()} enabled</Badge>
          </div>
        </div>
      </Card>

      {/* MFA re-enrollment */}
      <Card style={{ background: "var(--vx-console-surface)", border: "1px solid var(--vx-console-border)", borderRadius: 12 }}>
        <div style={cardBodyStyle}>
          <h2 style={{ ...textStyle, fontSize: "1.05rem", margin: 0 }}>MFA re-enrollment</h2>
          <p style={{ ...mutedStyle, margin: 0 }}>
            Lost access to your authenticator app, or setting up a new device? Scan the code below to
            re-enroll. This replaces your current TOTP factor once verified.
          </p>
          {reenrollment ? (
            <TotpSetup
              accountLabel={reenrollment.accountLabel}
              issuerLabel={reenrollment.issuerLabel}
              otpauthUri={reenrollment.otpauthUri}
              qrCodeImageSrc={reenrollment.qrCodeImageSrc}
            />
          ) : (
            <p style={mutedStyle}>
              Couldn&apos;t reach the auth service to generate a re-enrollment code right now. Make sure
              the backend (or the local mock backend, <code>bun run mock-backend</code>) is running, then
              refresh this page.
            </p>
          )}
        </div>
      </Card>

      {/* Active sessions */}
      <Card style={{ background: "var(--vx-console-surface)", border: "1px solid var(--vx-console-border)", borderRadius: 12 }}>
        <div style={cardBodyStyle}>
          <h2 style={{ ...textStyle, fontSize: "1.05rem", margin: 0 }}>Active sessions</h2>
          <DataGrid style={{ display: "grid", gap: "0.5rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--vx-console-border)",
              }}
            >
              <div style={{ display: "grid", gap: "0.15rem" }}>
                <span style={textStyle}>{session.displayName}</span>
                <span style={{ ...mutedStyle, fontSize: "0.85rem" }}>
                  {session.mfaLevel.toUpperCase()} verified session
                </span>
              </div>
              <Badge style={{ color: "var(--vx-console-accent)" }}>This device</Badge>
            </div>
          </DataGrid>
          <p style={{ ...mutedStyle, fontSize: "0.85rem", margin: 0 }}>
            Only the current session is shown — per-device session listing/revocation requires a backend
            endpoint this plan does not yet define (see §45&apos;s proposed API surface).
          </p>
        </div>
      </Card>
    </div>
  );
}
