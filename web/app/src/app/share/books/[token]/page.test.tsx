import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SharedBookPage, { metadata } from "./page";
import {
  isValidShareToken,
  startShareLinkValidation,
} from "./SharedBookFallback";

describe("shared book fallback route", () => {
  test("exports private static metadata", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
    expect(metadata.alternates).toBeUndefined();
  });

  test("awaits a valid token and renders an app fallback without exposing it as text", async () => {
    const token = `book_${"a".repeat(38)}`;
    const page = await SharedBookPage({ params: Promise.resolve({ token }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Continue in Vorinthex");
    expect(html).toContain("Open app");
    expect(html).toContain("Download app");
    expect(html).not.toContain(`>${token}<`);
  });

  test("strictly rejects malformed and out-of-range tokens", async () => {
    expect(isValidShareToken("a".repeat(43))).toBe(true);
    expect(isValidShareToken(`${"A_b-9".repeat(8)}abc`)).toBe(true);
    expect(isValidShareToken("a".repeat(42))).toBe(false);
    expect(isValidShareToken("a".repeat(44))).toBe(false);
    expect(isValidShareToken(`${"a".repeat(42)}!`)).toBe(false);

    const page = await SharedBookPage({
      params: Promise.resolve({ token: `${"a".repeat(42)}!` }),
    });
    expect(renderToStaticMarkup(page)).toContain("Shared audio book unavailable");
  });
});

describe("shared book link validation", () => {
  test("posts only the token, opens the encoded stream, and reacts to inactive access", async () => {
    const token = `boo_${"z".repeat(39)}`;
    const states: string[] = [];
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    let streamUrl = "";
    let accessListener: ((event: MessageEvent<string>) => void) | undefined;
    let closeCount = 0;
    const cleanup = startShareLinkValidation(token, (state) => states.push(state), {
      fetch: async (input, init) => {
        requestUrl = input;
        requestInit = init;
        return Response.json({ status: "active" });
      },
      openEventSource: (url) => {
        streamUrl = url;
        return {
          addEventListener: (_type: "access", listener: (event: MessageEvent<string>) => void) => {
            accessListener = listener;
          },
          close: () => { closeCount += 1; },
          onerror: null,
        };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestUrl).toBe("/api/v1/public/books/shares/read");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.credentials).toBe("omit");
    expect(JSON.parse(String(requestInit?.body))).toEqual({ token });
    expect(streamUrl).toBe(`/api/v1/public/books/shares/stream?token=${encodeURIComponent(token)}`);
    expect(states).toEqual(["active"]);

    accessListener?.(new MessageEvent("access", {
      data: JSON.stringify({ status: "inactive" }),
    }));
    expect(states).toEqual(["active", "unavailable"]);
    expect(closeCount).toBe(1);

    cleanup();
    expect(closeCount).toBe(2);
  });

  test("does not stream a rejected or inactive share", async () => {
    for (const response of [
      new Response(null, { status: 404 }),
      Response.json({ status: "inactive" }),
    ]) {
      const states: string[] = [];
      let opened = false;
      startShareLinkValidation("a".repeat(43), (state) => states.push(state), {
        fetch: async () => response,
        openEventSource: () => {
          opened = true;
          throw new Error("must not open");
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(states).toEqual(["unavailable"]);
      expect(opened).toBe(false);
    }
  });
});
