# Phase 4 — Modes Layer & Security Enforcement

## Goal

Build the 23 modes — the layer where human context (which member is asking, which apps they can see, which agents they can talk to) actually gets enforced. This is the single most security-critical phase in the entire build.

This phase is self-contained.

## Background

The system enforces three independent, layered security checks that must ALL be correct, every time, with no exceptions:

1. **`allowed_modes`** — does the calling agent even have this mode available? Stored as an array on `companies.graph.agents[id].allowed_modes`, set once at agent creation, never mutable afterward by any runtime path.
2. **`allowed_member_ids`** — does the ORIGINAL human caller have access to whichever agent is ultimately being consulted, including TRANSITIVELY through `consult_agents`/`delegate_to_agents` chains? (Without this check, a member restricted to Agent A could ask Agent A to internally consult Agent B on their behalf, leaking B's data — a "confused deputy" attack. This must be checked against the ORIGINAL caller at every hop, not just the immediate one.)
3. **`allowed_app_ids`** — is every piece of data this mode reads filtered to only the apps the original human caller can see, BEFORE that data ever enters any agent's reasoning context? (Filtering happens at the database query level, never as a post-hoc response filter — the model's reasoning itself must never be exposed to data it shouldn't see, even if the final answer would have been filtered anyway.)

**Critical UX rule**: a permission failure is NEVER a thrown exception. It's always a normal text response (e.g. `"You do not have access to consult this agent."`) that the calling agent receives and can reason about / communicate naturally — exactly like any other answer it might get.

**Critical structural rule**: an Agent serves an entire COMPANY, not a single app — so even a fully-authorized agent-to-agent conversation must still scope its underlying data reads to the original human caller's `allowed_app_ids`, because the same agent might legitimately have data from multiple apps within its reasoning otherwise.

## Relevant schema (from Phase 1)

`companies.graph.agents[id]` includes: `allowed_modes: string[]`, `allowed_member_ids: string[]`, `managers: [...]`.

`company_member_app_access` table: `member_id`, `app_id` — defines which apps a member can see.

`company_event_app_links` / `company_output_app_links` tables: normalized join tables linking events/outputs to the apps they're relevant to (an event or output CAN be relevant to multiple apps, e.g. a cross-app agent thought comparing two products).

## What to build

### Security infrastructure (build first, everything else depends on it)

```typescript
interface SecurityContext {
  calling_member_id: string;
  calling_agent_id: string;
  allowed_app_ids: string[];
}
```

This type must be threaded through every mode call — never optional, never defaulted to "all access."

- `checkAllowedModes(agentId, modeSlug): Promise<boolean>` — reads `companies.graph.agents[agentId].allowed_modes`.
- `checkAllowedMemberAccess(agentId, memberId): Promise<boolean>` — reads `allowed_member_ids`. Members with `company_roles.slug === 'owner'` bypass this check entirely regardless of the list — verify their role first.
- `getMemberAllowedAppIds(memberId): Promise<string[]>` — reads from `company_member_app_access`.

### File structure

```
src/core/modes/
  ask.ts
  consult_agents.ts
  delegate_to_agents.ts
  inject_strategy.ts
  review_role.ts
  query_insights.ts
  read_library.ts
  read_posts.ts
  read_users.ts
  read_revenue.ts
  query_events.ts
  read_context.ts
  read_agent_objective.ts
  read_strategies.ts
  read_proposal_history.ts
  build_agent.ts
  edit_agent.ts
  rate_agent.ts
  list_agents.ts
  trigger_agent.ts
  read_objectives.ts
  write_objectives.ts
  save_thought.ts
  rerun_context.ts
  build_dashboard.ts
  write_strategy.ts
  index.ts
```

### `consult_agents.ts` — implement exactly this pattern, all other communication modes follow it

```typescript
// src/core/modes/consult_agents.ts
//
// THE most security-sensitive file in the system. Enforces all three
// checks before any cross-agent data can flow. A permission failure
// is always a normal text response, never a thrown exception.

interface ConsultAgentsInput {
  target_agent_ids: string[];
  question: string;
  calling_member_id: string;             // injected by the system
  calling_member_allowed_app_ids: string[]; // injected by the system
}

export async function consult_agents({
  target_agent_ids,
  question,
  calling_member_id,
  calling_member_allowed_app_ids,
}: ConsultAgentsInput): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  for (const targetId of target_agent_ids) {
    const hasAccess = await checkAllowedMemberAccess(targetId, calling_member_id);

    if (!hasAccess) {
      results[targetId] = 'You do not have access to consult this agent.';
      continue;
    }

    results[targetId] = await runAgentTurn(targetId, question, {
      app_ids: calling_member_allowed_app_ids,
    });
  }

  return results;
}
```

`delegate_to_agents` follows the same pattern, semantically for downward (parent-to-child) communication rather than upward/sideways.

### Communication modes

- **`ask`** — direct question to a specific agent. Still checks `allowed_member_ids` on the target.
- **`consult_agents`** — as specified above.
- **`delegate_to_agents`** — same security checks, downward direction.
- **`inject_strategy`** — a parent agent pushes strategic direction to a child, who responds by writing its own strategy (via `write_strategy`, see below) — the parent never writes the child's strategy directly.
- **`review_role`** — evaluates Role output when requested by a Manager, returns `{ decision: 'approved' | 'rejected', reasoning: string }`.

### Data modes — EVERY one of these MUST accept and enforce `allowed_app_ids` by filtering at the query level

- **`query_insights`** — broad analytical queries against `company_events`.
- **`read_library`** — content library reads from `company_outputs`.
- **`read_posts`** — published post outputs and performance.
- **`read_users`** — user lifecycle/health data, if applicable to the company's domain.
- **`read_revenue`** — financial event data.
- **`query_events`** — direct structured queries against `company_events`, period/category/slug filters, always scoped by `app_ids`.
- **`read_context`** — loads an agent's own history (chronological) or another agent's history (semantic, via embedding similarity). MUST filter by `allowed_app_ids` — this is what prevents an agent from "waking up" with cross-app memories it shouldn't have for the current conversation.
- **`read_agent_objective`** — reads the `objectives` string from an agent's graph entry.
- **`read_strategies`** — reads strategy files from S3 via `ACTION_FETCH_S3_CONTEXT`.
- **`read_proposal_history`** — reads historical approved/rejected objective-change proposals.

### Agent management modes

- **`build_agent`** — wraps `ACTION_CREATE_AGENT`.
- **`edit_agent`** — for technical-defect-only fixes to an agent's config — explicitly document in the function comment that this is NOT for strategic changes (those require building a new agent, per the immutability principle).
- **`rate_agent`** — records a performance rating.
- **`list_agents`** — lists all agents in a company with manager links and run counters.
- **`trigger_agent`** — triggers a specific agent to run once.

### CAO-style modes

- **`read_objectives`** — reads one or all agents' objectives.
- **`write_objectives`** — does NOT write directly. Creates a proposal (a simple mechanism is fine for this phase — e.g. logging a `objectives:proposal_created` event with the proposed change in the payload; full TOTP-gated human approval can be layered on later).

### Memory modes

- **`save_thought`** — takes `{ mode, props, raw_output, context }`. Determines Type 1 (rerunnable — came from a `query_*`/`read_*` mode) vs Type 2 (operational — came from an action-taking mode) based on which mode triggered it. Enriches the raw output into a thought via `get_model`, computes an embedding, writes to `company_events` with `slug: 'agent:thought'`. **Critical**: this write must link the correct `app_ids` via `company_event_app_links`, taken from the `SecurityContext` it was called with — this is what makes `read_context`'s later filtering actually work.
- **`rerun_context`** — takes a stored `{ mode, props }` recipe from a previous Type 1 thought, re-validates and re-executes to get fresh data. Refuses to run on Type 2 recipes, returning a clear explanatory message, not an error.

### Misc

- **`build_dashboard`** — shell only: accept a structured input spec, return `{ status: 'not_implemented' }`.
- **`write_strategy`** — writes a new datestamped strategy file to S3 for the CALLING agent only. The `agent_key`/`agent_id` is always injected from the session/security context, never accepted as a caller-supplied parameter — an agent can only ever write its own strategy, never another agent's.

### `index.ts`

Same registry pattern as Phase 3's Actions index:

```typescript
export const MODE_HANDLERS = {
  ask,
  consult_agents,
  delegate_to_agents,
  // ... every mode
} as const;

export type ModeSlug = keyof typeof MODE_HANDLERS;
```

Note: a mode existing in this registry does NOT mean every agent can use it — `allowed_modes` on the specific agent is the actual authorization gate, checked before dispatch.

## Success criteria

- **Test 1 (confused deputy)**: create two agents, A and B, in the same company. Set `allowed_member_ids` on B to NOT include a test member's id. Have that member ask A to `consult_agents` B. Confirm the result is a normal text response denying access — not a thrown error — and confirm A's reasoning context never actually received B's real data.
- **Test 2 (app scoping)**: a member with `allowed_app_ids: ['app_1']` triggers `query_events` via an agent. Seed events linked to both `app_1` and `app_2`. Confirm only `app_1` events are ever returned, and confirm by inspecting the actual query (not just the final response) that `app_2` data was filtered at the database query level, never loaded into application memory.
- **Test 3 (mode gating)**: attempt to call a mode not present in an agent's `allowed_modes`. Confirm it's rejected before the mode's handler logic even executes.
- **Test 4 (thought scoping)**: confirm `save_thought` correctly distinguishes Type 1 vs Type 2 based on triggering mode, and the resulting event has correct `app_ids` links.

This phase is not done until all four tests pass. Do not proceed with a known security gap — flag it explicitly instead of working around it silently.
