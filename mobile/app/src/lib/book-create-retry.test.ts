import { expect, test } from "bun:test";

import { restoredBookDraft, retryBookCreateRequestKey } from "./book-create-retry";

const input = { topic: "Useful habits", goal: "Build a practice", currentKnowledge: "Beginner", language: "English", writingTone: "Clear", narratorVoiceKey: "clear" as const, narrationPace: 1, archiveDocumentKeys: ["document"], chapterImages: true, additionalInstructions: undefined };

test("restores failed input and reuses its idempotency key unchanged", () => {
  const failed = { input, requestKey: "original" };
  const restored = restoredBookDraft(failed);
  expect(restored.additionalInstructions).toBe("");
  expect(retryBookCreateRequestKey(failed, restored, () => "new")).toBe("original");
});

test("uses a fresh key after a restored draft changes", () => {
  const failed = { input, requestKey: "original" };
  expect(retryBookCreateRequestKey(failed, { ...input, goal: "A different goal" }, () => "new")).toBe("new");
});
