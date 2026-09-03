import { describe, expect, test } from "bun:test";
import { fitContainedMediaSize } from "./media-layout";

describe("contained media layout", () => {
  test("fits landscape, portrait, and square media inside the viewport", () => {
    expect(fitContainedMediaSize({ width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({ width: 100, height: 50 });
    expect(fitContainedMediaSize({ width: 100, height: 200 }, { width: 100, height: 100 })).toEqual({ width: 50, height: 100 });
    expect(fitContainedMediaSize({ width: 100, height: 100 }, { width: 80, height: 60 })).toEqual({ width: 60, height: 60 });
  });

  test("falls back to the viewport for missing intrinsic dimensions", () => {
    expect(fitContainedMediaSize({ width: 0, height: 0 }, { width: 80, height: 60 })).toEqual({ width: 80, height: 60 });
  });
});
