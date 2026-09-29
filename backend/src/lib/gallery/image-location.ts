export class GalleryImageInputError extends Error {
  code = 'INVALID_IMAGE';
  constructor(message = 'Invalid image') { super(message); this.name = 'GalleryImageInputError'; }
}
export function imageLocation(..._args: unknown[]) { return null; }
export async function sanitizeGalleryImage(bytes: Uint8Array, ..._args: unknown[]): Promise<{ bytes: Uint8Array }> {
  return { bytes };
}
export function inspectGalleryImageInput(_bytes: Uint8Array): { mimeType: string; width: number; height: number } {
  throw new GalleryImageInputError();
}
