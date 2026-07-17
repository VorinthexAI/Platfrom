import { describe, expect, test } from "bun:test";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  test("parses complete events with event names and data", () => {
    const parser = createSseParser();
    const events = parser.push('event: response.delta\ndata: {"text":"Hi"}\n\n');
    expect(events).toEqual([{ event: "response.delta", data: '{"text":"Hi"}' }]);
  });

  test("buffers events split across arbitrary chunk boundaries", () => {
    const parser = createSseParser();
    expect(parser.push("event: response.de")).toEqual([]);
    expect(parser.push('lta\ndata: {"text":"He')).toEqual([]);
    const events = parser.push('llo"}\n\nevent: response.completed\ndata: {}\n\n');
    expect(events).toEqual([
      { event: "response.delta", data: '{"text":"Hello"}' },
      { event: "response.completed", data: "{}" },
    ]);
  });

  test("handles CRLF delimiters, comments, and multi-line data", () => {
    const parser = createSseParser();
    const events = parser.push(": heartbeat\r\n\r\nevent: response.delta\r\ndata: line one\r\ndata: line two\r\n\r\n");
    expect(events).toEqual([{ event: "response.delta", data: "line one\nline two" }]);
  });

  test("defaults the event name to message", () => {
    const parser = createSseParser();
    expect(parser.push("data: plain\n\n")).toEqual([{ event: "message", data: "plain" }]);
  });

  test("emits nothing for incomplete trailing frames", () => {
    const parser = createSseParser();
    expect(parser.push("event: response.delta\ndata: {}")).toEqual([]);
  });
});
