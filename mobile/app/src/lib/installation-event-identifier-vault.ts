import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  encodeInstallationEventIdentifier,
  INSTALLATION_EVENT_IDENTIFIER_BYTES,
  isInstallationEventIdentifier,
} from "./installation-event-identifier-format";

const INSTALLATION_EVENT_IDENTIFIER_KEY = "vorinthex.events.installation-identifier.v1";
export const INSTALLATION_EVENT_IDENTIFIER_HEADER = "X-Vorinthex-Event-Identifier";
let initialization: Promise<string> | undefined;

async function durableInstallationSeed() {
  if (Platform.OS !== "android") return null;
  const androidId = Application.getAndroidId();
  return androidId ? `android:${androidId}` : null;
}

async function createInstallationEventIdentifier() {
  const seed = await durableInstallationSeed();
  if (!seed) {
    return encodeInstallationEventIdentifier(Crypto.getRandomBytes(INSTALLATION_EVENT_IDENTIFIER_BYTES));
  }
  return (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA512, `vorinthex.installation.v1:${seed}`)).toLowerCase();
}

async function initializeInstallationEventIdentifier() {
  const stored = await SecureStore.getItemAsync(INSTALLATION_EVENT_IDENTIFIER_KEY);
  if (isInstallationEventIdentifier(stored)) return stored;

  const identifier = await createInstallationEventIdentifier();
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
