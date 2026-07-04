Remove the idle/running/error status field from Agent entirely. Agents are now treated as pure function calls — concurrent invocations are expected and supported, the same way Role and Manager already work.
Read the current implementation of Agent status handling, the mind_busy/agent_busy rejection logic, and anywhere companies.graph.agents[id].status is read or written, before making changes.
Part 1 — Schema change
On every Agent object in companies.graph:

Remove the status field entirely.
Add active_run_count: number (starts at 0).
Add total_run_count: number (starts at 0).

This matches the exact pattern already used on Role and Manager — increment active_run_count at the start of an invocation, decrement at the end (success or failure either way, via a finally-equivalent), increment total_run_count on every invocation regardless of outcome. Use the same updateGraphSafely locking helper already used everywhere else for companies.graph mutations — never write these counters outside that pattern.
Migrate any existing seeded/test data: drop the status field, initialize active_run_count: 0 and total_run_count: 0 on every existing Agent.
Part 2 — Remove the busy-rejection logic
Find every place that currently checks an Agent's status before allowing a new invocation (the mind_busy/agent_busy pattern — likely in the ask mode, consult_agents, delegate_to_agents, or wherever an Agent is triggered). Remove this check entirely. A new invocation should never be rejected because the Agent is "already running" — it should simply proceed, incrementing active_run_count as described in Part 1.
Remove any mind_busy/agent_busy error type, message, or response shape from the codebase if one exists solely for this purpose.
Part 3 — Confirm no broken assumptions elsewhere
Search the codebase for any other logic that assumed an Agent only ever processes one request at a time — for example, anything that stored "current conversation state" in a single mutable slot per Agent rather than per-invocation. Each Agent invocation must be fully self-contained (its own enrich → reasoning → modes → response flow) with no shared mutable state between concurrent invocations other than the already-locked companies.graph writes. Flag and fix anything you find that assumed otherwise.
Success criteria

companies.graph.agents[id] no longer has a status field anywhere in the schema, types, or migrated data.
Triggering the same Agent twice in rapid succession (before the first call completes) succeeds for both calls — no rejection, no error — and active_run_count correctly reflects 2 while both are in flight, dropping to 0 once both complete.
total_run_count correctly increments on every invocation, including ones that error out partway through.
No remaining references to mind_busy, agent_busy, or an Agent-level status check anywhere in the codebase — confirm via a full grep.
Two concurrent invocations of the same Agent that both call save_thought do not corrupt or lose either thought — both are correctly persisted as separate events.