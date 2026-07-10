import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers } from './base';
import { withArangoKey } from './base';

export const ORGANIZATIONS_COLLECTION = 'organizations';

export const organizationSchema = z.object({
  key: z.string(),
  name: z.string(),
  /** Exactly one organization is the root — Vorinthex AI itself. Every
   * user, visitor, session, and event hangs off it via organizationId. */
  is_root: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Organization = z.infer<typeof organizationSchema>;

export const organizationsEmbedKeys = z.enum(['name']);

const helpers = createNodeHelpers(ORGANIZATIONS_COLLECTION, organizationSchema, organizationsEmbedKeys.options);

export const insertOrganization = helpers.insert;
export const getOrganizationById = helpers.getById;
export const updateOrganization = helpers.updateById;
export const deleteOrganization = helpers.deleteById;
export const upsertOrganization = helpers.upsertByKey;
export const getAllOrganizationsChunked = helpers.getAllChunked;
export const listOrganizationsPage = helpers.listPage;

export async function getRootOrganization(): Promise<Organization | null> {
  const cursor = await db.query(aql`
    FOR organization IN ${db.collection(ORGANIZATIONS_COLLECTION)}
      FILTER organization.is_root == true
      LIMIT 1
      RETURN organization
  `);
  const doc = await cursor.next();
  return doc ? organizationSchema.parse(withArangoKey(doc)) : null;
}
