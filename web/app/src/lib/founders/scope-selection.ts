import type { AccessibleScopeOption } from "./types";

/**
 * Default scope for an organization, in order: the last locally selected
 * scope when it is still accessible, then the first accessible leaf scope
 * (the list arrives ordered by hierarchy and position), then none.
 */
export function selectDefaultScope(
  scopes: readonly AccessibleScopeOption[],
  storedKey: string | null,
): string | null {
  if (storedKey && scopes.some((scope) => scope.key === storedKey)) return storedKey;
  return scopes[0]?.key ?? null;
}
