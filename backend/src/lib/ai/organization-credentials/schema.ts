import { z } from 'zod';
import { organizationKeySchema } from '@/lib/ai/shared/ids';

export const ORGANIZATION_CREDENTIALS_COLLECTION = 'orgCredentials';

export type OrganizationCredentialValue = string | number | boolean | null | OrganizationCredentialValue[] | { [key: string]: OrganizationCredentialValue };
export const organizationCredentialValueSchema: z.ZodType<OrganizationCredentialValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(organizationCredentialValueSchema), z.record(organizationCredentialValueSchema),
]));
export const organizationCredentialsSchema = z.record(organizationCredentialValueSchema);

export const organizationCredentialSchema = z.object({
  key: z.string().cuid(),
  organizationKey: organizationKeySchema,
  providerKey: z.string().cuid(),
  encryptedCredentials: z.string().regex(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
}).strict();

export type OrganizationCredential = z.infer<typeof organizationCredentialSchema>;
export type OrganizationCredentials = z.infer<typeof organizationCredentialsSchema>;
