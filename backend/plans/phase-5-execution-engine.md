# Phase 5 — Agent Execution Engine & Concurrency

## Goal

Build the runtime that executes Agents, Managers, Roles, and Tasks: job queues, concurrency control, graph locking, and Manager-driven Role chaining.

## Background

- Agents are treated as pure function calls. Concurrent invocations are expected and tracked with run counters.
- Managers hold operational intelligence through `assignment`, own reusable Roles, and decide what happens after a Role finishes.
- Roles are dumb task runners. They do not reason and do not have `on_complete`.
- Agents, Roles, and Tasks use `active_run_count` and `total_run_count`; many parallel executions are expected.

## Relevant schema

`companies.graph.agents[id]`: `active_run_count`, `total_run_count`, `allowed_modes`, `allowed_member_ids`, `managers: [cuid]`.

`companies.graph.managers[id]`: `assignment`, `roles: [cuid]`, `active_run_count`, `total_run_count`, `used_by_agents: [cuid]`.

`companies.graph.roles[id]`: `concurrency`, `active_run_count`, `total_run_count`, `cadence`, `last_run_at`, `tasks: [cuid]`, `used_by_managers: [cuid]`.

`companies.graph.tasks[id]`: `actions: [{ action_slug, order }]`, `active_run_count`, `total_run_count`, `used_by_roles: [cuid]`.

## What to build

1. Create BullMQ queues per Role slug.
2. Execute Task action sequences through `ACTION_HANDLERS`.
3. Execute Roles by running their Tasks in order.
4. Log `role:completed` from orchestration code after every Role completion, success or failure.
5. Wake only the Manager that triggered the Role run (`manager_id` on the job). A Role run without a Manager logs completion but does not chain.
6. The Manager validates the Role output against its current assignment, logs `manager:decision`, and may enqueue another owned Role or stop.

## Success criteria

- Role and Task run counters update correctly under concurrent execution.
- A Role without `manager_id` never auto-chains.
- A Role with `manager_id` logs `role:completed`, then the Manager logs `manager:decision`.
- A Manager can only enqueue Roles it owns.
- Concurrent graph updates do not lose mutations.
