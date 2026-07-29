import { afterEach, describe, expect, test } from "bun:test";
import {
  activeChorusMentionQuery,
  chorusChannelEntrySchema,
  buildChorusMentionRows,
  CHORUS_ORCHESTRATOR_NAMES,
  chorusMentionRosterSchema,
  chorusMessageSchema,
  chorusThreadSchema,
  closestChorusMentionCompletion,
  filterChorusMentionShortcuts,
  plainChorusText,
  coalesceChorusStreamEvents,
  markChorusStreamFailed,
  mergeChorusMessageRefresh,
  parseChorusSseFrame,
  reconcileChorusStreamEvent,
  streamChorusMessage,
  type ChorusDisplayMessage,
  type ChorusOptimisticStream,
} from "./chorus";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const timestamp = "2026-07-24T12:00:00.000Z";
const stored = { key: "message_key", channelKey: "channel_key", content: "Hello", createdAt: timestamp, updatedAt: timestamp };

describe("Chorus schemas", () => {
  test("parses the shared general channel entry", () => {
    const orchestrator = { key: "general", name: "General", role: "Organization channel" };
    const channel = { key: "channel_key", organizationKey: "organization_key", scopeKey: "scope_key", kind: "group", name: "general", position: 0, createdAt: timestamp, updatedAt: timestamp };
    expect(chorusChannelEntrySchema.parse({ orchestrator, scopeKey: "scope_key", canChat: true, channel }).channel?.key).toBe("channel_key");
    expect(() => chorusChannelEntrySchema.parse({ orchestrator, scopeKey: "scope_key", canChat: true, channel: null })).toThrow();
  });

  test("parses a canonical message projection", () => {
    const message = chorusMessageSchema.parse({
      ...stored,
      author: { participantKey: "participant_key", type: "orchestrator", key: "atlas_key", name: "Atlas" },
      reactions: [{ reaction: "ack", count: 2, viewerReacted: true }],
      thread: { key: "thread_key", status: "open", replyCount: 1, lastReplyAt: timestamp },
      poll: { key: "poll_key", question: "Proceed?", allowMultiple: false, status: "open", closedAt: null, options: [{ key: "option_a", text: "Yes", position: 0, voteCount: 1, viewerVoted: true }, { key: "option_b", text: "No", position: 1, voteCount: 0, viewerVoted: false }] },
    });
    expect(message.author.name).toBe("Atlas");
    expect(message.poll?.options).toHaveLength(2);
    expect(message.poll?.closedAt).toBeNull();
  });

  test("normalizes nullable optional message identifiers", () => {
    const message = chorusMessageSchema.parse({
      ...stored,
      threadKey: null,
      replyToMessageKey: null,
      author: { participantKey: "participant_key", type: "user", key: "user_key", name: "Founder" },
      reactions: [],
      thread: null,
      poll: null,
    });
    expect(message.threadKey).toBeUndefined();
    expect(message.replyToMessageKey).toBeUndefined();
  });

  test("accepts archived thread projections as non-open threads", () => {
    const archived = chorusThreadSchema.parse({ key: "thread_key", channelKey: "channel_key", title: "Archived thread", rootMessageKey: "message_key", status: "archived", createdAt: timestamp, updatedAt: timestamp });
    const message = chorusMessageSchema.parse({
      ...stored,
      author: { participantKey: "participant_key", type: "user", key: "user_key", name: "User" },
      reactions: [],
      thread: { key: archived.key, status: archived.status, replyCount: 2, lastReplyAt: timestamp },
      poll: null,
    });
    expect(archived.status).toBe("archived");
    expect(message.thread?.status).toBe("archived");
  });
});

describe("Chorus mention rows", () => {
  const orchestratorNames = [...CHORUS_ORCHESTRATOR_NAMES];
  const roster = chorusMentionRosterSchema.parse({
    orchestrators: orchestratorNames.map((name, index) => ({ participantKey: `participant-${index}`, type: "orchestrator", key: `agent-${index}`, name, role: "Executive", mentionCount: 20 - index })),
    everyone: { participantKey: "everyone", type: "everyone", key: "everyone", name: "everyone", mentionCount: 0 },
    members: ["Anton", "Frank", "Josef", "Vincent"].map((name, index) => ({ participantKey: `member-${index}`, type: "user", key: `user-${index}`, name, mentionCount: index })),
  });

  test("renders the explicit roster as exactly two permanent lanes", () => {
    const rows = buildChorusMentionRows(roster);
    expect(rows.orchestrators.map(({ name }) => name)).toEqual(orchestratorNames);
    expect(rows.people.map(({ name }) => name)).toEqual(["everyone", "Anton", "Frank", "Josef", "Vincent"]);
    expect(rows.ordered).toHaveLength(25);
  });

  test("requires all twenty orchestrators in the API contract", () => {
    expect(() => chorusMentionRosterSchema.parse({ ...roster, orchestrators: roster.orchestrators.slice(1) })).toThrow();
  });

  test("filters shortcuts only while an active mention query is being typed", () => {
    const mentions = buildChorusMentionRows(roster).ordered;
    expect(activeChorusMentionQuery("plain text")).toBeNull();
    expect(activeChorusMentionQuery("ask @sOM")).toBe("som");
    expect(activeChorusMentionQuery("ask(@MET")).toBe("met");
    expect(filterChorusMentionShortcuts(mentions, activeChorusMentionQuery("ask @met")).map(({ name }) => name)).toEqual(["Metis"]);
    expect(filterChorusMentionShortcuts(mentions, activeChorusMentionQuery("ask @"))).toHaveLength(25);
  });

  test("provides canonical muted completion text for the closest mention", () => {
    const mentions = buildChorusMentionRows(roster).ordered;
    expect(closestChorusMentionCompletion(mentions, "ask @at")).toMatchObject({ mention: { name: "Atlas" }, suffix: "las" });
    expect(closestChorusMentionCompletion(mentions, "ask @aT")).toMatchObject({ mention: { name: "Atlas" }, suffix: "las" });
    expect(closestChorusMentionCompletion(mentions, "ask @Atlas")).toBeNull();
    expect(closestChorusMentionCompletion(mentions, "ask @unknown")).toBeNull();
  });
});

describe("shared button controls", () => {
  test("enforces the shared radius, sizes, and application-level usage", async () => {
    const component = await Bun.file(new URL("../../components/founders/HqCommunicationOverlay.tsx", import.meta.url)).text();
    const mobileHome = await Bun.file(new URL("../../../../../mobile/app/src/components/HomeConstellation.tsx", import.meta.url)).text();
    const theme = await Bun.file(new URL("../../../../../shared/packages/ui/theme.css", import.meta.url)).text();
    const guidance = await Bun.file(new URL("../../../../../AGENTS.md", import.meta.url)).text();
    expect(component).toContain("CHORUS_ORCHESTRATOR_NAMES.map");
    expect(component).toContain('variant="primary"');
    expect(component).toContain('variant="secondary"');
    expect(component).toContain('className={`relative flex gap-3 px-1 py-3');
    expect(component).toContain('"cursor-pointer focus-visible:outline-2');
    expect(component).toContain('!message.key.startsWith("optimistic-")');
    expect(component).not.toContain("a, [role='button']");
    expect(component).not.toContain("group-hover:pointer-events-auto");
    expect(component).toContain("Button, SearchInput, Spinner, Textarea");
    expect(component).toContain('placeholder="Search..."');
    expect(component).toContain("skinTonesDisabled");
    expect(component).toContain('aria-label="Mention shortcuts"');
    expect(component).not.toContain("<button");
    expect(mobileHome).toContain('from "@vorinthex/shared/ui/button"');
    expect(mobileHome).not.toContain("PressableScale");
    for (const size of ["xs", "sm", "md", "lg", "xl"]) {
      expect(theme).toContain(`.vui-button-${size}`);
    }
    expect(theme).toContain("border-radius: var(--vui-radius-pill) !important");
    expect(theme).toContain("text-transform: none !important");
    expect(theme).toContain('.vui-button-primary:disabled');
    expect(component).toContain(">Channels</span>");
    expect(component).not.toContain('selected ? "bg-[var(--panel-strong)]');
    expect(component).not.toContain("aria-current");
    expect(theme.match(/opacity: 0\.8;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(guidance).toContain("Do not create app-local UI primitives");
    expect(guidance).toContain("one of its five sizes (`xs`, `sm`, `md`, `lg`, `xl`)");
    expect(guidance).toContain("Disabled primary actions must remain visibly identifiable at 80% opacity");
  });
});

describe("Chorus stream reconciliation", () => {
  const stream: ChorusOptimisticStream = { streamKey: "stream_1", userKey: "temp_user", channelKey: "channel_key" };
  const author = { participantKey: "optimistic", type: "user" as const, key: "optimistic", name: "You" };
  const optimistic: ChorusDisplayMessage[] = [
    { ...stored, key: stream.userKey, author, reactions: [], thread: null, poll: null, clientState: { streamKey: stream.streamKey, state: "optimistic" } },
  ];

  test("creates and reconciles a separate optimistic response for every orchestrator", () => {
    const started = reconcileChorusStreamEvent(optimistic, stream, { type: "start", channelKey: "channel_key", userMessage: { ...stored, key: "canonical_user" } });
    const atlasStarted = reconcileChorusStreamEvent(started, stream, { type: "assistant-start", orchestrator: { participantKey: "atlas-participant", key: "atlas", name: "Atlas" } });
    const atlasTokenized = reconcileChorusStreamEvent(atlasStarted, stream, { type: "token", orchestratorKey: "atlas", text: "Hi" });
    const atlasDone = reconcileChorusStreamEvent(atlasTokenized, stream, { type: "done", orchestratorKey: "atlas", message: { ...stored, key: "canonical_atlas", content: "Hi" } });
    const metisStarted = reconcileChorusStreamEvent(atlasDone, stream, { type: "assistant-start", orchestrator: { participantKey: "metis-participant", key: "metis", name: "Metis" } });
    const completed = reconcileChorusStreamEvent(metisStarted, stream, { type: "token", orchestratorKey: "metis", text: "Hello" });
    expect(completed.map((message) => message.key)).toEqual(["canonical_user", "canonical_atlas", expect.stringContaining("metis")]);
    expect(completed.map((message) => message.content)).toEqual(["Hello", "Hi", "Hello"]);
    expect(completed.map((message) => message.clientState?.state)).toEqual(["reconciling", "reconciling", "pending"]);
    expect(reconcileChorusStreamEvent(completed, stream, { type: "assistant-error", orchestratorKey: "metis" }).map((message) => message.key)).toEqual(["canonical_user", "canonical_atlas"]);
  });

  test("preserves active pending entries on unrelated refresh and removes them on final refresh", () => {
    const unrelated = chorusMessageSchema.parse({ ...stored, key: "older", author, reactions: [], thread: null, poll: null });
    expect(mergeChorusMessageRefresh(optimistic, [unrelated], true).map((message) => message.key)).toEqual(["older", "temp_user"]);
    expect(mergeChorusMessageRefresh(optimistic, [unrelated], false).map((message) => message.key)).toEqual(["older"]);
  });

  test("marks incomplete reconciliation as failed and non-canonical", () => {
    const failed = markChorusStreamFailed(optimistic, stream.streamKey, "Canonical refresh failed");
    expect(failed.every((message) => message.clientState?.state === "failed")).toBe(true);
    expect(failed[0]?.clientState?.error).toBe("Canonical refresh failed");
  });

  test("coalesces adjacent tokens without crossing lifecycle events", () => {
    expect(coalesceChorusStreamEvents([
      { type: "token", orchestratorKey: "atlas", text: "Hel" },
      { type: "token", orchestratorKey: "atlas", text: "lo" },
      { type: "error", error: "stopped" },
      { type: "token", orchestratorKey: "metis", text: "Again" },
    ])).toEqual([
      { type: "token", orchestratorKey: "atlas", text: "Hello" },
      { type: "error", error: "stopped" },
      { type: "token", orchestratorKey: "metis", text: "Again" },
    ]);
  });
});

describe("Chorus SSE client", () => {
  test("parses identified assistant streams through terminal completion", async () => {
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of [
          `event: start\ndata: ${JSON.stringify({ channelKey: "channel_key", userMessage: stored })}\n\nevent: assistant-start\ndata: {"orchestrator":{"participantKey":"atlas-participant","key":"atlas","name":"Atlas"}}\n\nevent: tok`,
          `en\ndata: {"orchestratorKey":"atlas","text":"Hi"}\n\nevent: done\ndata: ${JSON.stringify({ orchestratorKey: "atlas", message: { ...stored, key: "assistant_key", content: "Hi" } })}\n\nevent: complete\ndata: {}\n\n`,
        ]) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } })) as unknown as typeof fetch;
    const events: unknown[] = [];
    await streamChorusMessage("org_key", "channel_key", "Hello", (event) => events.push(event));
    expect(events.map((event) => (event as { type: string }).type)).toEqual(["start", "assistant-start", "token", "done", "complete"]);
  });

  test("surfaces backend errors and incomplete or malformed streams", async () => {
    globalThis.fetch = (async () => Response.json({ success: false, error: { code: "VALIDATION_ERROR", message: "invalid Chorus message" } }, { status: 400 })) as unknown as typeof fetch;
    await expect(streamChorusMessage("org", "channel", "hello", () => {})).rejects.toThrow("invalid Chorus message");
    globalThis.fetch = (async () => new Response('event: error\ndata: {"error":"provider failed"}\n\n')) as unknown as typeof fetch;
    await expect(streamChorusMessage("org", "channel", "hello", () => {})).rejects.toThrow("provider failed");
    globalThis.fetch = (async () => new Response('event: token\ndata: {"orchestratorKey":"atlas","text":"partial"}\n\n')) as unknown as typeof fetch;
    await expect(streamChorusMessage("org", "channel", "hello", () => {})).rejects.toThrow("ended unexpectedly");
    expect(() => parseChorusSseFrame("event: token\ndata: not-json")).toThrow("Malformed Chorus token event");
    expect(() => parseChorusSseFrame('event: start\ndata: {"channelKey":"channel_key"}')).toThrow("Malformed Chorus start event");
    expect(() => parseChorusSseFrame(`event: done\ndata: ${JSON.stringify({ orchestratorKey: "atlas", message: { ...stored, key: "assistant_key", content: 42 } })}`)).toThrow("Malformed Chorus done event");
  });

  test("supports cancellation", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort();
      throw init?.signal?.reason ?? new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(streamChorusMessage("org", "channel", "hello", () => {}, controller.signal)).rejects.toThrow();
  });
});

describe("Chorus message presentation", () => {
  test("renders markdown-shaped replies as plain text", () => {
    expect(plainChorusText("### Summary\n1. **Choose** the `[safe](https://example.com)` option.\n- `Act` now.")).toBe("Summary\nChoose the safe option.\nAct now.");
  });
});
