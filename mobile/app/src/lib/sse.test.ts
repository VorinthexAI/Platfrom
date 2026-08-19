import { expect, test } from "bun:test";
import { consumeServerSentEvents, eventStreamRetryDelay, invalidatesGalleryQueries, parseServerSentEvent } from "./sse";
import { publishAppEvent, subscribeAppEvent } from "./app-events";

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

test("parses invalidation events with an empty data payload", () => {
  expect(parseServerSentEvent("event: collection.index.changed\ndata:\n")).toEqual({ event: "collection.index.changed", data: "" });
});

test("maps every audited Gallery slug to invalidation", () => {
  for (const slug of ["collection.index.changed", "collection.content.changed", "collection.access.changed", "collection.invites.changed", "collection.shares.changed", "image.changed", "upload.changed", "subject.changed", "highlight.changed"]) expect(invalidatesGalleryQueries(slug)).toBe(true);
  expect(invalidatesGalleryQueries("unknown")).toBe(false);
});

test("bounds reconnect backoff and jitter", () => {
  expect(eventStreamRetryDelay(0, () => 0)).toBe(750);
  expect(eventStreamRetryDelay(20, () => 1)).toBe(37_500);
});

test("delivers app events to active subscribers only", () => {
  const events: string[] = [];
  const unsubscribe = subscribeAppEvent((event) => events.push(event.type));
  publishAppEvent({ type: "gallery.changed", slug: "collection.index.changed" });
  unsubscribe();
  publishAppEvent({ type: "event-stream.connected" });
  expect(events).toEqual(["gallery.changed"]);
});
