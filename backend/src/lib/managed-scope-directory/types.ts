import type { Collection } from '@/lib/db/collections.node';
import type { CollectionImage } from '@/lib/db/collection-images.node';
import type { Document } from '@/lib/db/documents.node';
import type { Folder } from '@/lib/db/folders.node';
import type { Image } from '@/lib/db/images.node';

export interface ManagedScopeDirectoryState {
  folders: Folder[];
  documents: Document[];
  collections: Collection[];
  images: Image[];
  relations: CollectionImage[];
}

export interface ManagedScopeDirectoryApplyResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export interface ManagedScopeDirectoryRepository {
  load(scopeKeys: string[]): Promise<ManagedScopeDirectoryState>;
  apply(state: ManagedScopeDirectoryState, scopeKeys: string[], now: string): Promise<ManagedScopeDirectoryApplyResult>;
}
