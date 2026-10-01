export function queryBelongsToTeamScope(queryKey: readonly unknown[], teamKey: string, scopeKey: string) {
  return queryKey.some((part) => part === teamKey || part === scopeKey);
}

type PendingTeamMfa = { status: "setup_required" | "totp_required"; challengeToken: string; teamKey?: string; scopeKey?: string; expiresAt?: string };
let pendingTeamMfa: PendingTeamMfa | null = null;
export function setPendingTeamMfaChallenge(status: PendingTeamMfa["status"], challengeToken: string) { pendingTeamMfa = { status, challengeToken }; }
export function takePendingTeamMfa() { const value = pendingTeamMfa; pendingTeamMfa = null; return value; }
