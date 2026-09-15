import { describe, expect, mock, test } from "bun:test";

mock.module("./api-client", () => ({ apiClient: {}, postEventStream: async () => undefined }));

const client = await import("./agent-greeting-client");
const context = { userKey: "user", teamKey: "team", scopeKey: "scope" };
const correlationKey = "greeting-request";
const messageKey = "cm123456789";
const topics = [
  { key: "one", label: "First topic", question: "Tell me about the first topic" },
  { key: "two", label: "Second topic", question: "Tell me about the second topic" },
  { key: "three", label: "Third topic", question: "Tell me about the third topic" },
];

type Frame = { event: string; data: string; id?: string };
const frame = (event: string, data: Record<string, unknown>, id = correlationKey): Frame => ({ event, id, data: JSON.stringify({ type: event, correlationKey: id, ...data }) });
const greetingDelta = frame("delta", { messageKey, text: "Hello " });
const greetingDone = frame("done", { messageKey, message: "Hello there", showReferralCodeAction: true, topicsPending: true, persistenceToken: "signed-greeting" });
const topicFrames = topics.map((topic) => frame("topic", { topic }));
const topicsDone = frame("done", { topics, persistenceToken: "signed-topics" });

function transport(frames: Frame[], failure?: Error) {
  return async (path: string, body: unknown, emit: (event: Frame) => void, signal?: AbortSignal) => {
    expect(signal).toBeDefined();
    calls.push({ path, body });
    for (const event of frames) emit(event);
    if (failure) throw failure;
  };
}

const calls: { path: string; body: unknown }[] = [];

describe("strict greeting stream protocol", () => {
  test("streams matching deltas and resolves the canonical completion", async () => {
    const controller = new AbortController();
    const deltas: string[] = [];
    const done = await client.requestAgentGreetingWithTransport(transport([greetingDelta, greetingDone]), context, "onboarding", (event) => deltas.push(event.text), controller.signal);
    expect(deltas).toEqual(["Hello "]);
    expect(done).toMatchObject({ type: "done", messageKey, message: "Hello there", topicsPending: true, persistenceToken: "signed-greeting" });
    expect(calls.at(-1)).toEqual({ path: "/agent/greeting", body: { teamKey: "team", scopeKey: "scope", occasion: "onboarding" } });
  });

  test("rejects strict-schema, frame identity, correlation, and message-key violations", async () => {
    const run = (frames: Frame[]) => client.requestAgentGreetingWithTransport(transport(frames), context, "returning", () => undefined, new AbortController().signal);
    await expect(run([{ ...greetingDelta, data: JSON.stringify({ ...JSON.parse(greetingDelta.data), extra: true }) }])).rejects.toThrow();
    await expect(run([{ ...greetingDelta, event: "done" }])).rejects.toThrow("payload type");
    await expect(run([{ ...greetingDelta, id: undefined }])).rejects.toThrow("event id");
    await expect(run([greetingDelta, frame("delta", { messageKey, text: "there" }, "other")])).rejects.toThrow("active greeting");
    await expect(run([greetingDelta, frame("done", { messageKey: "cm987654321", message: "Other", showReferralCodeAction: false, topicsPending: false, persistenceToken: "token" })])).rejects.toThrow("completion");
  });

  test("rejects premature EOF, transport failures, and events after one terminal event", async () => {
    const run = (frames: Frame[], failure?: Error) => client.requestAgentGreetingWithTransport(transport(frames, failure), context, "returning", () => undefined, new AbortController().signal);
    await expect(run([greetingDelta])).rejects.toThrow("terminal");
    await expect(run([], new Error("network lost"))).rejects.toThrow("network lost");
    await expect(run([greetingDone, greetingDone])).rejects.toThrow("after its terminal");
  });

  test("throws a bounded domain error from a terminal error event", async () => {
    const error = frame("error", { code: "GREETING_FAILED", message: "Greeting unavailable" });
    try {
      await client.requestAgentGreetingWithTransport(transport([error]), context, "returning", () => undefined, new AbortController().signal);
      throw new Error("Expected the stream to fail.");
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error & { code?: string }).code).toBe("GREETING_FAILED");
      expect((caught as Error).message).toBe("Greeting unavailable");
    }
  });
});

describe("strict greeting topic stream protocol", () => {
  test("emits topics one by one and resolves only an exactly matching final three", async () => {
    const emitted: typeof topics = [];
    const done = await client.requestAgentGreetingTopicsWithTransport(transport([...topicFrames, topicsDone]), context, "signed-greeting", (event) => emitted.push(event.topic), new AbortController().signal);
    expect(emitted).toEqual(topics);
    expect(done).toEqual({ type: "done", correlationKey, topics, persistenceToken: "signed-topics" });
    expect(calls.at(-1)).toEqual({ path: "/agent/greeting/topics", body: { teamKey: "team", scopeKey: "scope", persistenceToken: "signed-greeting" } });
  });

  test("rejects duplicate streamed topics and non-identical final topic lists", async () => {
    const run = (frames: Frame[]) => client.requestAgentGreetingTopicsWithTransport(transport(frames), context, "signed-greeting", () => undefined, new AbortController().signal);
    await expect(run([topicFrames[0]!, frame("topic", { topic: { ...topics[1], label: topics[0]!.label.toUpperCase() } })])).rejects.toThrow("duplicate");
    await expect(run([...topicFrames, frame("done", { topics: [topics[1], topics[0], topics[2]], persistenceToken: "signed-topics" })])).rejects.toThrow("exactly match");
    await expect(run([topicFrames[0]!, topicsDone])).rejects.toThrow("exactly match");
  });

  test("rejects topic events after done and premature EOF", async () => {
    const run = (frames: Frame[]) => client.requestAgentGreetingTopicsWithTransport(transport(frames), context, "signed-greeting", () => undefined, new AbortController().signal);
    await expect(run(topicFrames)).rejects.toThrow("terminal");
    await expect(run([...topicFrames, topicsDone, topicFrames[0]!])).rejects.toThrow("after its terminal");
  });
});
