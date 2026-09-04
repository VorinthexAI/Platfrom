import { expect, test } from "bun:test";

import { useUiStore } from "../state/ui";

test("opens and closes the shared Sparks sheet idempotently", () => {
  useUiStore.setState({ sparksSheetOpen: false, sparksSheetReason: null });
  let changes = 0;
  const unsubscribe = useUiStore.subscribe(() => { changes += 1; });
  useUiStore.getState().openSparksSheet();
  useUiStore.getState().openSparksSheet();
  expect(useUiStore.getState().sparksSheetOpen).toBe(true);
  expect(useUiStore.getState().sparksSheetReason).toBe("manual");
  useUiStore.getState().openSparksSheet("insufficient-balance");
  useUiStore.getState().openSparksSheet("insufficient-balance");
  expect(useUiStore.getState().sparksSheetReason).toBe("insufficient-balance");
  useUiStore.getState().closeSparksSheet();
  useUiStore.getState().closeSparksSheet();
  expect(useUiStore.getState().sparksSheetOpen).toBe(false);
  expect(useUiStore.getState().sparksSheetReason).toBeNull();
  expect(changes).toBe(3);
  unsubscribe();
});
