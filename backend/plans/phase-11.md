This is a major restructuring of the companies.graph hierarchy. Read the entire current implementation first — every file under src/core/actions/, src/core/modes/, the companies.graph schema, and any execution/Role-chaining logic already built — before changing anything. This touches Agent, Role, Task relationships throughout the system, so confirm you understand the current state before making changes.
The new hierarchy
Agent     → immutable after creation (already true). Owns Managers.
Manager   → NEW. Immutable after creation. All operational intelligence
            lives here now: has an `assignment` (replaces what Role's
            "mission" used to be), validates every Role completion
            against that assignment, decides what happens next.
Role      → becomes DUMB. No more reasoning, no more `on_complete`.
            Just: concurrency, cadence, tasks[]. Logs `role:completed`
            when done, then does nothing further itself.
Task      → unchanged.
Action    → unchanged (already locked to manual-deploy-only after the
            OpenCode chain removal).
Both Role and Manager can be shared/reused: a single Role can be used by multiple Managers (used_by_managers: [cuid]), and a single Manager can be used by multiple Agents (used_by_agents: [cuid]). Agents, Roles, and Managers all use active_run_count/total_run_count; many parallel executions are expected and supported.
Part 1 — Schema changes to companies.graph
Add a new top-level key: managers.
Agent changes:

Remove agent.roles entirely.
Add agent.managers: [cuid] — agents now point to Managers, never directly to Roles.

Manager (new object shape):
json{
  "slug": "string (e.g. MANAGER_SEO)",
  "name": "string (e.g. SEO Expert)",
  "assignment": "string — enriched/summarized text, built the same way the old Role-level mission was built: pulled from S3 datestamped files, summarized + enriched before each run, see Part 3",
  "used_by_agents": ["cuid"],
  "roles": ["cuid"],
  "active_run_count": "number",
  "total_run_count": "number",
  "created_at": "ISO string"
}
Role changes — remove and rename fields:

REMOVE on_complete entirely — this logic moves to Manager (Part 2).
RENAME used_by_agents to used_by_managers.
Role retains: slug, name, concurrency, active_run_count, total_run_count, cadence, tasks: [cuid], used_by_managers: [cuid].

Task: unchanged.
Write the migration to transform any existing seeded/test graph data into this new shape — do not just change the TypeScript types, actually migrate any data that exists.
Part 2 — Manager-driven Role chaining (replaces on_complete)
The old on_complete array on Role (with direct/delayed/on_approve/on_human_approve trigger types) is removed entirely. ALL Role-to-Role transitions now go through an active Manager decision — there is no more automatic direct trigger. Every transition is now, functionally, what on_approve used to be — except the approver is always the owning Manager, never an arbitrary agent.
New flow, replacing the old on_complete listener:

A Role finishes execution (success or failure either way), decrements its active_run_count, increments total_run_count.
It logs a role:completed event to company_events (same logging-happens-at-orchestration-level principle as before — never inside an Action).
Every Manager that has this Role in its roles array and is currently "listening" (i.e. was the one that triggered this particular run) wakes up in response to that event.
The Manager runs a validation step: compare the Role's output against the Manager's current assignment (load fresh via the process in Part 3 — never use a stale cached assignment).
Based on that validation, the Manager — using its own reasoning, not a static lookup table — decides what to do next: trigger another Role it owns, re-trigger the same Role with adjusted input, or stop and log why.
