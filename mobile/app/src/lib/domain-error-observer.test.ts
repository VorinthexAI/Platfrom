import { expect, test } from "bun:test";

import { createObservedHttpError, extractDomainErrorCode, observeDomainError, rejectObservedDomainError, subscribeDomainErrors } from "./domain-error-observer";

test("extracts exact codes from Axios responses, envelopes, and direct SSE errors", () => {
  expect(extractDomainErrorCode({ response: { data: { success: false, error: { code: "INSUFFICIENT_BALANCE" } } } })).toBe("INSUFFICIENT_BALANCE");
  expect(extractDomainErrorCode({ response: { data: { code: "INSUFFICIENT_BALANCE" } } })).toBe("INSUFFICIENT_BALANCE");
  expect(extractDomainErrorCode({ data: { error: { code: "INSUFFICIENT_BALANCE" } } })).toBe("INSUFFICIENT_BALANCE");
  expect(extractDomainErrorCode(Object.assign(new Error("terminal"), { code: "INSUFFICIENT_BALANCE" }))).toBe("INSUFFICIENT_BALANCE");
});

test("does not treat storage or similar text as insufficient balance", () => {
  expect(extractDomainErrorCode({ code: "STORAGE_UNFUNDED" })).toBe("STORAGE_UNFUNDED");
  expect(extractDomainErrorCode(new Error("INSUFFICIENT_BALANCE"))).toBeUndefined();
});

test("parses non-2xx streaming backend envelopes through the same observer", () => {
  const seen: unknown[] = [];
  const unsubscribe = subscribeDomainErrors((error) => seen.push(error));
  const error = createObservedHttpError(402, JSON.stringify({ success: false, error: { code: "INSUFFICIENT_BALANCE", message: "More Sparks required." } }));
  expect(error.message).toBe("More Sparks required.");
  expect(extractDomainErrorCode(error)).toBe("INSUFFICIENT_BALANCE");
  expect(seen).toEqual([error]);
  const malformed = createObservedHttpError(503, "not json");
  expect(malformed.message).toBe("Streaming request failed with status 503.");
  unsubscribe();
});

test("notifies once for the same error object and preserves its identity", async () => {
  const seen: unknown[] = [];
  const unsubscribe = subscribeDomainErrors((error) => seen.push(error));
  const error = Object.assign(new Error("No Sparks"), { code: "INSUFFICIENT_BALANCE" });
  expect(observeDomainError(error)).toBe(error);
  expect(observeDomainError(error)).toBe(error);
  expect(seen).toEqual([error]);
  try {
    await rejectObservedDomainError(error);
    throw new Error("expected rejection");
  } catch (caught) {
    expect(caught).toBe(error);
  }
  expect(seen).toEqual([error]);
  unsubscribe();
});

test("observes separate repeated insufficient-balance failures", () => {
  let count = 0;
  const unsubscribe = subscribeDomainErrors(() => { count += 1; });
  observeDomainError({ code: "INSUFFICIENT_BALANCE" });
  observeDomainError({ code: "INSUFFICIENT_BALANCE" });
  observeDomainError({ code: "STORAGE_UNFUNDED" });
  expect(count).toBe(2);
  unsubscribe();
});
