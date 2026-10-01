import type { Database } from 'arangojs';
import { COMMERCE_CATALOG } from '../../lib/commerce/catalog';
import { productSchema } from '../../lib/commerce/contracts';
import { toArangoDoc, withArangoKey } from '../../lib/db/base';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function seedCommerceCatalog(database: Database) {
  for (const rawProduct of COMMERCE_CATALOG) {
    const product = productSchema.parse(rawProduct);
    const existingCursor = await database.query('FOR item IN products FILTER item.productId == @productId LIMIT 1 RETURN item', { productId: product.productId });
    const row = await existingCursor.next();
    const existing = row ? productSchema.parse(withArangoKey(row as Record<string, unknown>)) : null;
    const seeded = productSchema.parse({
      ...product,
      key: existing?.key ?? product.key,
      providerProductId: existing?.providerProductId ?? null,
      createdAt: existing?.createdAt ?? product.createdAt,
    });
    const result = await database.query(`
      UPSERT { productId: @productId }
        INSERT @product
        UPDATE UNSET(@product, "_key") IN products
      RETURN NEW
    `, { productId: seeded.productId, product: toArangoDoc(seeded) });
    if (!await result.next()) throw new Error(`Failed to seed commerce product ${product.productId}.`);
  }
}

export const commerceCatalogMigration: GraphMigration = {
  id: '0004-commerce-catalog',
  checksum: () => checksumMigrationFiles([
    new URL(import.meta.url),
    new URL('../../lib/commerce/catalog.ts', import.meta.url),
    new URL('../../lib/commerce/contracts.ts', import.meta.url),
  ]),
  up: seedCommerceCatalog,
};
