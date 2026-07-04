import 'dotenv/config';
import { syncPolarProducts } from '@/api/payments';
import { closeDb } from '@/lib/db/client';

try {
  const results = await syncPolarProducts();
  console.table(results);
} finally {
  await closeDb();
}
