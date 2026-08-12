import { z } from 'zod';

export const ORGANIZATION_CONNECTORS_COLLECTION = 'organizationConnectors';

export const emailConnectorCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().min(1).default('Bearer'),
  expiresAt: z.string().datetime(),
}).strict();
export type EmailConnectorCredentials = z.infer<typeof emailConnectorCredentialsSchema>;

export const organizationConnectorSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().min(1),
  scopeKey: z.string().cuid(),
  provider: z.literal('gmail'),
  providerAccountId: z.string().min(1),
  email: z.string().email(),
  encryptedCredentials: z.string().min(1),
  encryptionKeyId: z.string().min(1),
  accessTokenFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(z.string().min(1)).min(1),
  createdByMembershipKey: z.string().cuid(),
  status: z.enum(['active', 'error', 'revoked']),
  lastRefreshedAt: z.string().datetime().optional(),
  lastError: z.string().max(500).optional(),
  revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrganizationConnector = z.infer<typeof organizationConnectorSchema>;
