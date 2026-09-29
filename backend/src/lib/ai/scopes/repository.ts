export const SCOPE_REMOVAL_WRITE_COLLECTIONS: string[] = [];
export function createScopeRepository(..._args: unknown[]) {
  return { async removeScope(..._inner: unknown[]) {} };
}
