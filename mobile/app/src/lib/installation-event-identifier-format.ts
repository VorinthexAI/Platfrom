export const INSTALLATION_EVENT_IDENTIFIER_BYTES = 64;

export function isInstallationEventIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{128}$/.test(value);
}

export function encodeInstallationEventIdentifier(bytes: Uint8Array): string {
  if (bytes.length !== INSTALLATION_EVENT_IDENTIFIER_BYTES) {
    throw new TypeError(`Installation event identifiers require exactly ${INSTALLATION_EVENT_IDENTIFIER_BYTES} bytes.`);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
