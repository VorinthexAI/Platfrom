import { expect, test } from "bun:test";
import { consumeServerSentEvents, parseServerSentEvent } from "./sse";

test("parses named multiline server-sent events", () => {
  expect(parseServerSentEvent("id: 4\r\nevent: chunk\r\ndata: {\"part\":\r\ndata: 1}\r\n")).toEqual({ event: "chunk", id: "4", data: '{"part":\n1}' });
});

test("consumes complete frames while retaining a partial frame", () => {
  const events: unknown[] = [];
  const remainder = consumeServerSentEvents("event: start\ndata: {}\n\nevent: chunk\ndata: {\"index\":0}\n\nevent: chu", (event) => events.push(event));
  expect(events).toEqual([{ event: "start", data: "{}" }, { event: "chunk", data: '{"index":0}' }]);
  expect(remainder).toBe("event: chu");
});

test("ignores comments and frames without data", () => {
  expect(parseServerSentEvent(": heartbeat\n\nevent: done")).toBeUndefined();
});
