import { NativeModules, Platform } from "react-native";

type NativeClipboard = { setString?: (value: string) => void };

export async function copyToClipboard(value: string) {
  if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }
  const clipboard = NativeModules.Clipboard as NativeClipboard | undefined;
  if (!clipboard?.setString) throw new Error("Clipboard is unavailable on this device.");
  clipboard.setString(value);
}
