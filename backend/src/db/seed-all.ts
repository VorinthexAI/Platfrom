import { closeDb } from '@/lib/db/client';
import { seedCoreDbNodes } from '@/lib/db/seed';

await seedCoreDbNodes();
await closeDb();
