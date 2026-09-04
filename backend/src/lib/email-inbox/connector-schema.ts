import { z } from 'zod';

export const ORGANIZATION_CONNECTORS_COLLECTION = 'organizationConnectors';

export const emailProviderSchema = z.literal('gmail');
export type EmailProvider = z.infer<typeof emailProviderSchema>;

export const oauthEmailConnectorCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().min(1).default('Bearer'),
  expiresAt: z.string().datetime(),
}).strict();
export const emailConnectorCredentialsSchema = oauthEmailConnectorCredentialsSchema;
export type EmailConnectorCredentials = z.infer<typeof emailConnectorCredentialsSchema>;
export type OAuthEmailConnectorCredentials = z.infer<typeof oauthEmailConnectorCredentialsSchema>;

export const organizationConnectorSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().min(1),
  scopeKey: z.string().cuid(),
  provider: emailProviderSchema,
  providerAccountId: z.string().min(1),
  email: z.string().email(),
  encryptedCredentials: z.string().min(1),
  encryptionKeyId: z.string().min(1),
  accessTokenFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(z.string().min(1)).min(1),
  createdByMembershipKey: z.string().cuid(),
  billingUserKey: z.string().cuid().optional(),
  billingStatus: z.enum(['funded', 'unfunded', 'recovery-pending', 'disabled']).optional(),
  billingPeriodStartedAt: z.string().datetime().optional(),
  status: z.enum(['active', 'error', 'revoked']),
  syncEnabled: z.boolean().default(true),
  initialSyncCompleted: z.boolean().default(false),
  historyId: z.string().trim().min(1).optional(),
  pendingNotificationHistoryId: z.string().regex(/^\d+$/).optional(),
  syncPendingHistoryId: z.string().trim().min(1).optional(),
  syncPendingThreadIds: z.array(z.string().min(1)).max(100_000).optional(),
  syncPendingSubscriptionMessages: z.array(z.object({ id: z.string().min(1).max(500), threadId: z.string().min(1).max(500) }).strict()).max(100_000).optional(),
  lastSyncedAt: z.string().datetime().optional(),
  syncStatus: z.enum(['idle', 'syncing', 'error']).default('idle'),
  syncError: z.string().max(500).optional(),
  syncLeaseToken: z.string().uuid().optional(),
  syncLeaseExpiresAt: z.string().datetime().optional(),
  sendLeaseToken: z.string().uuid().optional(),
  sendLeaseExpiresAt: z.string().datetime().optional(),
  watchRegisteredAt: z.string().datetime().optional(),
  watchExpiresAt: z.string().datetime().optional(),
  lastRefreshedAt: z.string().datetime().optional(),
  lastError: z.string().max(500).optional(),
  revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type OrganizationConnector = z.infer<typeof organizationConnectorSchema>;
