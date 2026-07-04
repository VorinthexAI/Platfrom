import { createId } from '@paralleldrive/cuid2';

export function newId(_prefix?: string) {
  return createId();
}

