export async function resolveImageReference(..._args: unknown[]) { return null; }
export function imageDataUrl(bytes: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}
