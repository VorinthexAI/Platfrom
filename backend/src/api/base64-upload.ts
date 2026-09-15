const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Linear validation: repeated four-character regex groups hit engine limits on photos. */
export function isCanonicalUploadBase64(value: string): boolean {
  if (!value.length || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const payload = value.slice(0, value.length - padding);
  if (/[^A-Za-z0-9+/]/.test(payload)) return false;
  const last = alphabet.indexOf(payload.at(-1)!);
  return last >= 0 && (padding === 2 ? (last & 15) === 0 : padding === 1 ? (last & 3) === 0 : true);
}
