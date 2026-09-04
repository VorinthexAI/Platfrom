import { expect, test } from "bun:test";

const core = await Bun.file(new URL("../components/PersistentCoreComposer.tsx", import.meta.url)).text();

test("avoids a duplicate Core toast while retaining insufficient-balance rollback", () => {
  expect(core).toContain('if (!isInsufficientBalanceError(error)) showToast({ title: message, duration: 2_000 })');
  expect(core).toContain("setPendingMessages((current) => current.filter");
  expect(core).toContain("restoreSentAttachments(submittedAttachments)");
});

test("restores a failed submitted prompt only before the user edits a newer draft", () => {
  expect(core).toContain("const submittedDraftRevision = draftRevision.current");
  expect(core).toContain("if (draftRevision.current === submittedDraftRevision) setInput(content)");
  expect(core).toContain("onChangeText={(value) => { draftRevision.current += 1; setInput(value); }}");
});
