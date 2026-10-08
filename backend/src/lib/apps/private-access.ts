export function parsePrivateAgentAccessEmails(value = process.env.PRIVATE_AGENT_ACCESS_EMAILS) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function emailHasPrivateAgentAccess(email: string | null | undefined) {
  if (!email) return false;
  return parsePrivateAgentAccessEmails().has(email.trim().toLowerCase());
}
