import { closeDb } from './client';
import { newId } from '@/lib/ids';
import { getPlatformByName, insertPlatform, updatePlatform, type Platform } from './platforms.node';
import { getProductByProductId, insertProduct, updateProduct, type Product } from './products.node';

type SeedResult = {
  collection: string;
  key: string;
  status: 'created' | 'updated';
};

const now = () => new Date().toISOString();

export const SEEDED_PRODUCTS = [
  {
    productId: 'private.beta.access',
    name: 'Private beta',
    type: 'subscription' as const,
    priceCents: 79900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'founder.access',
    name: 'Founder',
    type: 'subscription' as const,
    priceCents: 199900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'enterprise.access',
    name: 'Enterprise',
    type: 'subscription' as const,
    priceCents: 599900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'private.beta.access.ticket',
    name: 'Private beta ticket',
    type: 'one_time' as const,
    priceCents: 9900,
    billingPeriod: null,
    gracePeriod: null,
  },
];

export const SEEDED_PLATFORM = {
  name: 'this',
  metadata: {},
};

async function upsertSeedPlatform(seed: typeof SEEDED_PLATFORM): Promise<SeedResult> {
  const existing = await getPlatformByName(seed.name);
  if (!existing) {
    const key = newId();
    await insertPlatform({
      key,
      name: seed.name,
      metadata: seed.metadata,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'platforms', key, status: 'created' };
  }

  const patch: Partial<Omit<Platform, 'key' | 'embedding'>> = {
    name: seed.name,
    metadata: seed.metadata,
    updatedAt: now(),
  };
  await updatePlatform(existing.key, patch);
  return { collection: 'platforms', key: existing.key, status: 'updated' };
}

async function upsertSeedProduct(seed: (typeof SEEDED_PRODUCTS)[number]): Promise<SeedResult> {
  const existing = await getProductByProductId(seed.productId);
  if (!existing) {
    const key = newId();
    await insertProduct({
      ...seed,
      key,
      polarProductId: null,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'products', key, status: 'created' };
  }

  const patch: Partial<Omit<Product, 'key' | 'embedding'>> = {
    productId: seed.productId,
    name: seed.name,
    type: seed.type,
    priceCents: seed.priceCents,
    billingPeriod: seed.billingPeriod,
    gracePeriod: seed.gracePeriod,
    updatedAt: now(),
  };
  await updateProduct(existing.key, patch);
  return { collection: 'products', key: existing.key, status: 'updated' };
}

export async function seedCoreDbNodes(): Promise<SeedResult[]> {
  const results: SeedResult[] = [];

  results.push(await upsertSeedPlatform(SEEDED_PLATFORM));

  for (const product of SEEDED_PRODUCTS) {
    results.push(await upsertSeedProduct(product));
  }

  return results;
}

if (import.meta.main) {
  try {
    const results = await seedCoreDbNodes();
    console.table(results);
  } finally {
    await closeDb();
  }
}
