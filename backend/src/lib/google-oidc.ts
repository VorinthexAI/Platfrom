import { z } from 'zod';

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
let cachedKeys: { keys: GoogleJwk[]; expiresAt: number } | undefined;

function decode(value: string) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>; }
  catch { return null; }
}

async function defaultKeyLoader() {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const body = await response.json().catch(() => null) as { keys?: GoogleJwk[] } | null;
  if (!response.ok || !Array.isArray(body?.keys)) throw new Error('Google signing keys unavailable');
  const maximumAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cachedKeys = { keys: body.keys, expiresAt: Date.now() + Math.max(60, maximumAge) * 1000 };
  return body.keys;
}

const claimsSchema = z.object({
  iss: z.string(), aud: z.union([z.string(), z.array(z.string())]), sub: z.string().min(1), exp: z.number().int(),
  email: z.string().email(), email_verified: z.union([z.literal(true), z.literal('true')]),
}).passthrough();

export async function verifyGoogleOidcToken(
  token: string,
  expected: { audience: string; email: string },
  loadKeys: () => Promise<GoogleJwk[]> = defaultKeyLoader,
) {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null;
  const header = decode(encodedHeader);
  const parsedClaims = claimsSchema.safeParse(decode(encodedPayload));
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !parsedClaims.success) return null;
  let keys = await loadKeys();
  let key = keys.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === 'RS256') && (!candidate.use || candidate.use === 'sig'));
  if (!key && loadKeys === defaultKeyLoader) {
    cachedKeys = undefined;
    keys = await loadKeys();
    key = keys.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === 'RS256') && (!candidate.use || candidate.use === 'sig'));
  }
  if (!key) return null;
  const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signatureValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(encodedSignature, 'base64url'), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
  const claims = parsedClaims.data;
  const audienceMatches = claims.aud === expected.audience || (Array.isArray(claims.aud) && claims.aud.includes(expected.audience));
  const issuerMatches = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!signatureValid || !audienceMatches || !issuerMatches || claims.exp <= Math.floor(Date.now() / 1000) || claims.email.toLowerCase() !== expected.email.toLowerCase()) return null;
  return { subject: claims.sub, email: claims.email.toLowerCase() };
}
