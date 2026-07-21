export interface AskInput {
  skill: string;
  message: string;
}

/**
 * Placeholder for the real AI provider call — the orchestrator's skill is
 * piped in as the system prompt alongside the user's message. Wire an
 * actual provider client (Anthropic, OpenRouter, ...) in here when ready;
 * everything upstream (loading the orchestrator, its skill, the HTTP and
 * WebSocket entry points) already routes through this single function.
 */
export async function ask({ skill, message }: AskInput): Promise<string> {
  void skill;
  return `[not yet wired to an AI provider] ${message}`;
}
