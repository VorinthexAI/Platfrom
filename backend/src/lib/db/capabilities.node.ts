import { z } from 'zod';
import { createNodeHelpers } from './base';

export const CAPABILITIES_COLLECTION = 'capabilities';

export const capabilitySchema = z.object({
  key: z.string(),
  name: z.string(),
  storagePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Capability = z.infer<typeof capabilitySchema>;

export const capabilitiesEmbedKeys = z.enum(['name']);

const helpers = createNodeHelpers(CAPABILITIES_COLLECTION, capabilitySchema, capabilitiesEmbedKeys.options);

export const insertCapability = helpers.insert;
export const getCapabilityById = helpers.getById;
export const updateCapability = helpers.updateById;
export const deleteCapability = helpers.deleteById;
export const upsertCapabilityByKey = helpers.upsertByKey;
export const getAllCapabilitiesChunked = helpers.getAllChunked;
export const listCapabilitiesPage = helpers.listPage;

