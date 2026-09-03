# Internal Agents

Internal agents are server-owned AI orchestrators over the provider-neutral
`text` action and the unified public tool registry. `index.ts` owns the bounded
progressive-disclosure runtime, allowlist expansion, canonical `runTool`
dispatch, deterministic per-call idempotency, and safe tool-status feedback.
`core.ts` defines Core; `schemas.ts` owns strict internal and public contracts.

An empty allowlist authorizes all model-visible public unified tools. Exact
slugs and namespace wildcards such as `folder.*` are supported and deduplicated.
Each agent also owns `excludedTools`, which supports the same exact and wildcard
patterns and is applied after its allowlist.
All `agents.*` tools and `conversation.message.send` are excluded from every
agent candidate set to prevent recursive orchestration.
Model selections and native calls are untrusted and rechecked before each
dispatch.

The initial structured streaming decision receives grouped authorized slugs,
not full definitions. The server validates it as a mutually exclusive answer,
clarification, or execution plan. Empty selection streams the JSON `message`
value only after the generated output passes the deterministic internal-data
boundary.
Nonempty selection loads definitions only for selected tools and executes at
most four native calls, one at a time. Each result is followed by a structured
continuation decision that either requests another originally selected tool or
streams the final answer. Visible text mixed with native calls, unknown calls,
multiple calls, malformed routing, and provider protocol violations fail the
agent.

Tools execute only through canonical `runTool` adapters with trusted
`ToolContext` and hashed per-call request keys. Tool failures become safe failed
statuses so the model can recover. Arguments, context, results, and errors are
bounded and treated as untrusted data; oversized successful results are
reported with an omission marker rather than truncated. Production arguments
are strict-schema validated before dispatch. An empty `app.search` may be
reformulated once, and the server requires the retry to change only the query;
successful or twice-empty searches close that route for the request. Routing
and tool telemetry contains only stage, outcome, counts, confidence class, and
duration, never request or result payloads. The public `agents.core` tool has
one strict model input and lazily imports Core so `agents -> tools -> agents`
does not create an eager initialization cycle. Its adapter injects the system
prompt, current ISO date, request key, identity, organization, and scope.

## Live E2E

With the local API and its dependencies running, execute:

```bash
bun run --cwd backend test:e2e:core-agent-live
```

The opt-in suite uses the configured live text provider through the public
conversation HTTP and SSE flow. It checks a direct answer plus folder list,
create, update, and delete turns, verifies mutations through canonical Content
endpoints, checks persisted history, and removes its folder and conversation in
`finally`. It refuses non-local API hosts unless
`CORE_AGENT_E2E_DANGEROUS_REMOTE=true` is explicitly set.

The multilingual embedding smoke evaluation compares Swedish, Spanish,
German, and misspelled English workspace queries with relevant and unrelated
English resource descriptions using the configured production embedding model:

```bash
bun run --cwd backend test:embeddings:multilingual-live
```
