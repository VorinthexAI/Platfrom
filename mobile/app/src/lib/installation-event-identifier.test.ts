import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  encodeInstallationEventIdentifier,
  isInstallationEventIdentifier,
} from "./installation-event-identifier-format";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("installation event identifiers encode exactly 64 bytes as lowercase hex", () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);
  const identifier = encodeInstallationEventIdentifier(bytes);

  expect(identifier).toHaveLength(128);
  expect(identifier).toBe(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
  expect(isInstallationEventIdentifier(identifier)).toBe(true);
  expect(() => encodeInstallationEventIdentifier(new Uint8Array(63))).toThrow("exactly 64 bytes");
});

test("installation event identifier validation rejects corrupt and legacy values", () => {
  expect(isInstallationEventIdentifier("a".repeat(128))).toBe(true);
  expect(isInstallationEventIdentifier("A".repeat(128))).toBe(false);
  expect(isInstallationEventIdentifier("a".repeat(127))).toBe(false);
  expect(isInstallationEventIdentifier("g".repeat(128))).toBe(false);
  expect(isInstallationEventIdentifier(null)).toBe(false);
});

test("the persistent vault serializes initialization and replaces invalid SecureStore values", () => {
  const vault = read("./installation-event-identifier-vault.ts");

  expect(vault).toContain('import * as Crypto from "expo-crypto"');
  expect(vault).toContain('import * as SecureStore from "expo-secure-store"');
  expect(vault).toContain("Crypto.getRandomBytes(INSTALLATION_EVENT_IDENTIFIER_BYTES)");
  expect(vault).toContain("SecureStore.getItemAsync(INSTALLATION_EVENT_IDENTIFIER_KEY)");
  expect(vault).toContain("SecureStore.setItemAsync(INSTALLATION_EVENT_IDENTIFIER_KEY, identifier");
  expect(vault).toContain("if (!initialization)");
  expect(vault).not.toContain("deleteItemAsync");
});

test("global Axios and manual XHR SSE requests await the installation header", () => {
  const client = read("./api-client.ts");

  expect(client.match(/await getInstallationEventIdentifier\(\)/g)).toHaveLength(2);
  expect(client).toContain("headers.set(INSTALLATION_EVENT_IDENTIFIER_HEADER, eventIdentifier)");
  expect(client).toContain("[INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier");
  expect(client).toContain("request.setRequestHeader(name, value)");
});
