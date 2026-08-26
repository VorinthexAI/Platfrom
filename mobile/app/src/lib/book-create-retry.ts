import type { CreateBookInput } from "./books-client";

export type FailedBookCreate = { input: CreateBookInput; requestKey: string };

function normalized(input: CreateBookInput) {
  return { ...input, additionalInstructions: input.additionalInstructions?.trim() || undefined };
}

export function restoredBookDraft(failed: FailedBookCreate): CreateBookInput {
  return { ...failed.input, additionalInstructions: failed.input.additionalInstructions ?? "" };
}

export function retryBookCreateRequestKey(failed: FailedBookCreate | undefined, input: CreateBookInput, createKey: () => string) {
  return failed && JSON.stringify(normalized(failed.input)) === JSON.stringify(normalized(input)) ? failed.requestKey : createKey();
}
