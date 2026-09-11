import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function addEventDevice(database: Database) {
  await database.query('FOR event IN events FILTER !HAS(event, "device") UPDATE event WITH { device: null } IN events');
}

export const eventDeviceMigration: GraphMigration = {
  id: '0004-event-device',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: addEventDevice,
};
