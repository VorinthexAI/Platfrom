import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

export const DEVICE_IDENTIFIER_HEADER = 'X-Vorinthex-Device-Identifier';
export const deviceSchema = z.enum(['android', 'ios']);
export type Device = z.infer<typeof deviceSchema>;

const storage = new AsyncLocalStorage<Device>();

export function currentDevice(): Device | null {
  return storage.getStore() ?? null;
}

export function runWithDevice<T>(device: Device, execute: () => T): T {
  return storage.run(deviceSchema.parse(device), execute);
}
