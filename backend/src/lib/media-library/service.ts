import { z } from 'zod';
import { newId } from '@/lib/ids';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { getDefaultMediaLibraryRepository, type MediaLibraryRepository } from './repository';

const key = z.string().cuid();
const timestamp = z.string().datetime();
const relationInputSchema = z.object({ scopeKey: key, collectionKey: key, imageKey: key, actorKey: key, now: timestamp }).strict();
const moveInputSchema = relationInputSchema.extend({ sourceCollectionKey: key }).strict();
const coverInputSchema = z.object({ scopeKey: key, collectionKey: key, imageKey: key, ownerKey: key, now: timestamp }).strict();

export class MediaLibraryAccessError extends Error { constructor(message: string) { super(message); this.name = 'MediaLibraryAccessError'; } }
export interface MediaLibraryServiceDependencies { repository?: MediaLibraryRepository; newId?: () => string; }

export function createMediaLibraryService(dependencies: MediaLibraryServiceDependencies = {}) {
  const repository = dependencies.repository ?? getDefaultMediaLibraryRepository();
  const id = dependencies.newId ?? newId;
  const relation = (input: z.infer<typeof relationInputSchema>) => collectionImageSchema.parse({ key: id(), scopeKey: input.scopeKey, collectionKey: input.collectionKey, imageKey: input.imageKey, addedByKey: input.actorKey, createdAt: input.now });
  return {
    async addImageToCollection(raw: unknown) { const input = relationInputSchema.parse(raw); if (!await repository.canAccessImage(input.scopeKey, input.imageKey, input.actorKey)) throw new MediaLibraryAccessError('Source image access required'); return repository.addImageToCollection(relation(input)); },
    async copyImageToCollection(raw: unknown) { const input = relationInputSchema.parse(raw); if (!await repository.canAccessImage(input.scopeKey, input.imageKey, input.actorKey)) throw new MediaLibraryAccessError('Source image access required'); return repository.copyImageToCollection(relation(input)); },
    async moveImageBetweenCollections(raw: unknown) { const input = moveInputSchema.parse(raw); if (!await repository.canAccessImage(input.scopeKey, input.imageKey, input.actorKey)) throw new MediaLibraryAccessError('Source image access required'); return repository.moveImageBetweenCollections(input.sourceCollectionKey, relation(input)); },
    async setCollectionCoverImage(raw: unknown) { const input = coverInputSchema.parse(raw); if (!await repository.ownsCollection(input.scopeKey, input.collectionKey, input.ownerKey)) throw new MediaLibraryAccessError('Collection ownership required'); const saved = await repository.setCollectionCoverImage(input.scopeKey, input.collectionKey, input.imageKey, input.ownerKey, input.now); if (!saved) throw new MediaLibraryAccessError('Cover image must be a live image in the collection scope'); return saved; },
  };
}

export const mediaLibraryServiceInputSchemas = { relation: relationInputSchema, move: moveInputSchema, cover: coverInputSchema } as const;
