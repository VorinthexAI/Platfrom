export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${token}`;
}

export function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    diff |= aBytes[index] ^ bBytes[index];
  }
  return diff === 0;
}

async function deriveEncryptionKey() {
  const material = process.env.TOTP_SECRET_ENCRYPTION_KEY
    ?? process.env.ACCESS_TOKEN_SECRET
    ?? 'dev-totp-secret-encryption-key';
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1:${Buffer.from(iv).toString('base64url')}:${Buffer.from(ciphertext).toString('base64url')}`;
}

export async function decryptSecret(value: string) {
  if (!value.startsWith('v1:')) return value;
  const [, iv, ciphertext] = value.split(':');
  if (!iv || !ciphertext) throw new Error('invalid encrypted secret');
  const key = await deriveEncryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
    key,
    Buffer.from(ciphertext, 'base64url'),
  );
  return new TextDecoder().decode(plaintext);
}

