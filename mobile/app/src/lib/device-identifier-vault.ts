import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const DEVICE_IDENTIFIER_HEADER = "X-Vorinthex-Device-Identifier";
export type DeviceIdentifier = "android" | "ios";

const DEVICE_IDENTIFIER_KEY = "vorinthex.events.device-identifier.v1";
let initialization: Promise<DeviceIdentifier | null> | undefined;

function detectedDevice(): DeviceIdentifier | null {
  return Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : null;
}

async function initializeDeviceIdentifier() {
  const device = detectedDevice();
  if (!device) return null;
  const stored = await SecureStore.getItemAsync(DEVICE_IDENTIFIER_KEY);
  if (stored === "android" || stored === "ios") return stored;
  await SecureStore.setItemAsync(DEVICE_IDENTIFIER_KEY, device, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return device;
}

export function getDeviceIdentifier(): Promise<DeviceIdentifier | null> {
  if (!initialization) {
    initialization = initializeDeviceIdentifier().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}
