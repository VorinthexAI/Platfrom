export async function copyToClipboard(value: string) {
  if (!globalThis.navigator?.clipboard) throw new Error("Clipboard is unavailable on this device.");
  await globalThis.navigator.clipboard.writeText(value);
}
