import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./agent-greeting-client.ts", import.meta.url), "utf8");

test("requests a strict non-conversation greeting with trusted selectors", () => {
  expect(source).toContain('apiClient.post("/agent/greeting", body, { signal, timeout: 45_000 })');
  expect(source).toContain(".parse({ teamKey, scopeKey, occasion })");
  expect(source).not.toContain("conversationKey");
});

test("restricts greeting occasions before transport", () => {
  expect(source).toContain('occasion: z.enum(["onboarding", "returning"])');
  expect(source).toContain("responseSchema.parse(");
  expect(source).toContain("showReferralCodeAction: z.boolean()");
});
