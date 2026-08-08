import { expect, test } from "bun:test";
import { contentContext, hasContentContext } from "./knowledge-api";

test("requires the complete content context before remote workspace calls", () => {
  expect(hasContentContext).toBe(Object.values(contentContext).every(Boolean));
});
