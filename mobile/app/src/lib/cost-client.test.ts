import { expect, test } from "bun:test";

import { sparkCostsResponseSchema } from "./cost-client";

test("parses inbox, storage, and variable Spark charges while rejecting retired recurring contracts and grants", () => {
  const response = sparkCostsResponseSchema.parse({ success: true, data: { charges: [
    { key: "document.parse", kind: "static", name: "Parse a document", description: "Extract content.", sparkCost: "2", unit: "documents" },
    { key: "storage", kind: "storage", name: "Storage", description: "Charged hourly.", sparkCost: "30", unit: "gb-month" },
    { key: "inbox.sync", kind: "static", name: "Connect an inbox", description: "Initial import.", sparkCost: "100", unit: "invocation" },
    { key: "inbox.subscribe", kind: "static", name: "Receive a new email", description: "One new email.", sparkCost: "1", unit: "new-email" },
    { key: "ai-usage", kind: "variable", name: "AI actions", description: "Based on usage." },
  ] } });
  expect(response.data.charges).toHaveLength(5);
  expect(() => sparkCostsResponseSchema.parse({ success: true, data: { charges: [{ key: "connected-inbox", kind: "recurring", name: "Connected inbox", description: "Retired", sparkCost: "100", unit: "inbox-month" }] } })).toThrow();
  expect(() => sparkCostsResponseSchema.parse({ success: true, data: { charges: [{ key: "topup.small", kind: "grant", name: "Top-up", description: "Grant", sparkCost: "200", unit: "invocation" }] } })).toThrow();
});
