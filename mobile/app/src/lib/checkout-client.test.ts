import { expect, mock, test } from "bun:test";

mock.module("./api-client", () => ({ apiClient: {} }));

const { checkoutCallbackFromUrl } = await import("./checkout-client");

test("classifies only fixed checkout callback routes", () => {
  expect(checkoutCallbackFromUrl("vorinthexcore://checkout/success")).toBe("success");
  expect(checkoutCallbackFromUrl("vorinthexcore://checkout/error?reason=returned")).toBe("error");
  expect(checkoutCallbackFromUrl("https://vorinthex.com/checkout/success")).toBeUndefined();
  expect(checkoutCallbackFromUrl("vorinthexcore://checkout/success.evil")).toBeUndefined();
  expect(checkoutCallbackFromUrl("vorinthexcore://checkout/successful")).toBeUndefined();
});
