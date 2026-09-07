import 'dotenv/config';
import { closeDb } from '@/lib/db/client';
import { createArangoCommerceRepository } from '@/lib/commerce/repository';
import { createPolarProvider, PolarProviderError } from '@/lib/commerce/polar';
import { synchronizeCommerceProducts } from '@/lib/commerce/sync';

export async function syncCommerceProducts() {
  const repository = createArangoCommerceRepository();
  const provider = createPolarProvider();
  await synchronizeCommerceProducts(repository, provider);
}

if (import.meta.main) {
  try { await syncCommerceProducts(); }
  catch (error) {
    if (error instanceof PolarProviderError && error.code === 'NOT_CONFIGURED') console.warn('Polar catalog sync skipped: credentials are not configured.');
    else throw error;
  } finally { await closeDb(); }
}
