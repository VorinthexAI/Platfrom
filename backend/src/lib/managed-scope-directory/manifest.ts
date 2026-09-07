import { createHash } from 'node:crypto';
import { z } from 'zod';
import { APP_LOGO_MANIFEST, type AppLogoSlug } from '@/lib/apps/logo-manifest';

export const MANAGED_SCOPE_DIRECTORY_PURPOSE = 'scope-directory' as const;
export const MANAGED_SCOPE_DIRECTORY_PRODUCTS = ['vorinthex-ai', 'core', 'archive', 'gallery', 'signal', 'compass', 'ascend'] as const;
export type ManagedScopeDirectorySlug = typeof MANAGED_SCOPE_DIRECTORY_PRODUCTS[number];

const productSchema = z.object({
  key: z.string().cuid(),
  slug: z.enum(MANAGED_SCOPE_DIRECTORY_PRODUCTS),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  detailedDescription: z.string().trim().min(1),
}).strict();

export type ManagedScopeDirectoryProduct = z.infer<typeof productSchema>;
export type ManagedScopeDirectoryTargets = Record<ManagedScopeDirectorySlug, string>;

export function managedScopeDirectoryProduct(product: { key: string; slug: string; name: string; description: string; detailedDescription: string }): ManagedScopeDirectoryProduct {
  return productSchema.parse({ key: product.key, slug: product.slug, name: product.name, description: product.description, detailedDescription: product.detailedDescription });
}

export function managedScopeDirectoryKey(...parts: string[]): string {
  return `c${createHash('sha256').update(['managed-scope-directory-v1', ...parts].join('\0')).digest('hex').slice(0, 24)}`;
}

export function managedScopeDirectoryStorageKey(scopeKey: string, slug: ManagedScopeDirectorySlug, checksum: string): string {
  return `managed/scope-directory/v1/${scopeKey}/${slug}-${checksum}.png`;
}

export interface ManagedScopeDirectoryManifest {
  mother: ManagedScopeDirectoryProduct;
  products: readonly ManagedScopeDirectoryProduct[];
  targetScopeKeys: ManagedScopeDirectoryTargets;
  folders: Array<{ key: string; scopeKey: string; parentFolderKey?: string; name: string; ownerKey: string }>;
  documents: Array<{ key: string; scopeKey: string; folderKey: string; name: 'Brief' | 'Description'; content: string; ownerKey: string; slug: ManagedScopeDirectorySlug }>;
  collections: Array<{ key: string; scopeKey: string }>;
  logos: Array<{ key: string; scopeKey: string; collectionKey: string; relationKey: string; product: ManagedScopeDirectoryProduct; sourceStorageKey: string }>;
}

export function createManagedScopeDirectoryManifest(input: {
  products: readonly ManagedScopeDirectoryProduct[];
  targetScopeKeys: ManagedScopeDirectoryTargets;
}): ManagedScopeDirectoryManifest {
  const products = input.products.map((product) => productSchema.parse(product));
  if (products.length !== MANAGED_SCOPE_DIRECTORY_PRODUCTS.length) throw new Error('Managed scope directory requires exactly seven products.');
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  if (bySlug.size !== products.length || MANAGED_SCOPE_DIRECTORY_PRODUCTS.some((slug) => !bySlug.has(slug))) throw new Error('Managed scope directory requires each canonical product exactly once.');
  const targets = z.object(Object.fromEntries(MANAGED_SCOPE_DIRECTORY_PRODUCTS.map((slug) => [slug, z.string().cuid()])) as Record<ManagedScopeDirectorySlug, z.ZodString>).strict().parse(input.targetScopeKeys) as ManagedScopeDirectoryTargets;
  if (new Set(Object.values(targets)).size !== MANAGED_SCOPE_DIRECTORY_PRODUCTS.length) throw new Error('Managed scope directory target scopes must be unique.');
  const ordered = MANAGED_SCOPE_DIRECTORY_PRODUCTS.map((slug) => bySlug.get(slug)!);
  const mother = ordered[0]!;
  const folders: ManagedScopeDirectoryManifest['folders'] = [];
  const documents: ManagedScopeDirectoryManifest['documents'] = [];
  const collections: ManagedScopeDirectoryManifest['collections'] = [];
  const logos: ManagedScopeDirectoryManifest['logos'] = [];

  for (const target of ordered) {
    const scopeKey = targets[target.slug];
    const rootKey = managedScopeDirectoryKey('folder', scopeKey, 'root');
    const targetFolderKey = managedScopeDirectoryKey('folder', scopeKey, target.slug);
    folders.push({ key: rootKey, scopeKey, name: 'Scopes', ownerKey: target.key });
    folders.push({ key: targetFolderKey, scopeKey, parentFolderKey: rootKey, name: target.name, ownerKey: target.key });
    documents.push(
      { key: managedScopeDirectoryKey('document', scopeKey, target.slug, 'brief'), scopeKey, folderKey: targetFolderKey, name: 'Brief', content: target.description, ownerKey: target.key, slug: target.slug },
      { key: managedScopeDirectoryKey('document', scopeKey, target.slug, 'description'), scopeKey, folderKey: targetFolderKey, name: 'Description', content: target.detailedDescription, ownerKey: target.key, slug: target.slug },
    );
    if (target.slug === mother.slug) {
      for (const child of ordered.slice(1)) {
        const childFolderKey = managedScopeDirectoryKey('folder', scopeKey, child.slug);
        folders.push({ key: childFolderKey, scopeKey, parentFolderKey: targetFolderKey, name: child.name, ownerKey: child.key });
        documents.push(
          { key: managedScopeDirectoryKey('document', scopeKey, child.slug, 'brief'), scopeKey, folderKey: childFolderKey, name: 'Brief', content: child.description, ownerKey: child.key, slug: child.slug },
          { key: managedScopeDirectoryKey('document', scopeKey, child.slug, 'description'), scopeKey, folderKey: childFolderKey, name: 'Description', content: child.detailedDescription, ownerKey: child.key, slug: child.slug },
        );
      }
    }
    const collectionKey = managedScopeDirectoryKey('collection', scopeKey);
    collections.push({ key: collectionKey, scopeKey });
    const visibleProducts = target.slug === mother.slug ? ordered : [target];
    for (const product of visibleProducts) {
      const key = managedScopeDirectoryKey('image', scopeKey, product.slug);
      logos.push({ key, scopeKey, collectionKey, relationKey: managedScopeDirectoryKey('collection-image', scopeKey, product.slug), product, sourceStorageKey: APP_LOGO_MANIFEST[product.slug as AppLogoSlug].storageKey });
    }
  }
  return { mother, products: ordered, targetScopeKeys: targets, folders, documents, collections, logos };
}
