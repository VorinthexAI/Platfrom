import { describe, expect, test } from "bun:test";
import { validateChorusProxyPath } from "./chorus-proxy-path";

describe("Chorus proxy endpoint grammar", () => {
  test("accepts only known method/path combinations", () => {
    expect(validateChorusProxyPath("GET", "org_key", ["channels"])).toBe("channels");
    expect(validateChorusProxyPath("POST", "org_key", ["channels", "channel_1", "polls", "poll_1", "votes"])).toBe("channels/channel_1/polls/poll_1/votes");
    expect(validateChorusProxyPath("POST", "org_key", ["channels", "channel_1", "threads", "thread_1", "archive"])).toBe("channels/channel_1/threads/thread_1/archive");
    expect(validateChorusProxyPath("GET", "org_key", ["channels", "channel_1", "messages"], new URLSearchParams("limit=100"))).toBe("channels/channel_1/messages");
    expect(validateChorusProxyPath("GET", "org_key", ["channels", "channel_1", "messages"], new URLSearchParams("limit=201"))).toBeNull();
    expect(validateChorusProxyPath("DELETE", "org_key", ["channels"])).toBeNull();
  });

  test("rejects traversal and unrecognized endpoints", () => {
    expect(validateChorusProxyPath("GET", "org_key", ["..", "channels"])).toBeNull();
    expect(validateChorusProxyPath("GET", "org/key", ["channels"])).toBeNull();
    expect(validateChorusProxyPath("GET", "org_key", ["channels", "channel_1", "secrets"])).toBeNull();
    expect(validateChorusProxyPath("GET", "org_key", ["channels"], new URLSearchParams("debug=1"))).toBeNull();
  });
});
