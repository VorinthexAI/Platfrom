import { describe, expect, mock, test } from "bun:test";

mock.module("./api-client", () => ({ apiClient: {} }));
const { selectOnboardingSandboxPrompts } = await import("./onboarding-sandbox-client");

const prompts = Array.from({ length: 10 }, (_, index) => ({
  id: `prompt-${index}`,
  label: `Prompt ${index}`,
  question: `Question ${index}?`,
}));

describe("onboarding sandbox prompt selection", () => {
  test("selects three distinct prompts without mutating the server catalog", () => {
    const original = [...prompts];
    const selected = selectOnboardingSandboxPrompts(prompts, () => 0);
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(({ id }) => id)).size).toBe(3);
    expect(prompts).toEqual(original);
  });
});
