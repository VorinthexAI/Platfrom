import type { Database } from 'arangojs';
import { z } from 'zod';
import { COMMERCE_CATALOG } from '../../lib/commerce/catalog';
import { productSchema } from '../../lib/commerce/contracts';
import { toArangoDoc, withArangoKey } from '../../lib/db/base';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function up(database: Database) {
  for (const raw of COMMERCE_CATALOG) {
    const product = productSchema.parse(raw);
    const cursor = await database.query('FOR item IN products FILTER item.productId == @productId LIMIT 1 RETURN item', { productId: product.productId });
    const row = await cursor.next();
    const existing = row ? z.object({ key: z.string().cuid(), createdAt: z.string().datetime({ offset: true }) }).parse(withArangoKey(row as Record<string, unknown>)) : null;
    const seeded = { ...product, key: existing?.key ?? product.key, createdAt: existing?.createdAt ?? product.createdAt };
    await database.query('UPSERT { productId: @productId } INSERT @product UPDATE UNSET(@product, "_key") IN products', { productId: seeded.productId, product: toArangoDoc(seeded) });
  }
  await database.query('FOR item IN products FILTER item.productId == "nova.monthly.discounted" REMOVE item IN products');
  await database.query('FOR item IN products FILTER HAS(item, "providerProductId") || HAS(item, "discountedPriceCents") UPDATE item WITH { providerProductId: null, discountedPriceCents: null } IN products OPTIONS { keepNull: false }');
  for (const name of ['checkoutHandoffs', 'paymentCheckouts', 'commerceReconciliationRuns']) {
    const collection = database.collection(name);
    if (await collection.exists()) await collection.drop();
  }
}

export const storeCatalogMigration: GraphMigration = {
  id: '0010-store-catalog',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up,
};
