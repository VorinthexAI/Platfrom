import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  encodeInstallationEventIdentifier,
  INSTALLATION_EVENT_IDENTIFIER_BYTES,
  isInstallationEventIdentifier,
} from "./installation-event-identifier-format";

const INSTALLATION_EVENT_IDENTIFIER_KEY = "vorinthex.events.installation-identifier.v1";
export const INSTALLATION_EVENT_IDENTIFIER_HEADER = "X-Vorinthex-Event-Identifier";
let initialization: Promise<string> | undefined;

async function initializeInstallationEventIdentifier() {
  const stored = await SecureStore.getItemAsync(INSTALLATION_EVENT_IDENTIFIER_KEY);
  if (isInstallationEventIdentifier(stored)) return stored;

  const identifier = encodeInstallationEventIdentifier(
    Crypto.getRandomBytes(INSTALLATION_EVENT_IDENTIFIER_BYTES),
  );
  await SecureStore.setItemAsync(INSTALLATION_EVENT_IDENTIFIER_KEY, identifier, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return identifier;
}

export function getInstallationEventIdentifier(): Promise<string> {
  if (!initialization) {
    initialization = initializeInstallationEventIdentifier().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}
