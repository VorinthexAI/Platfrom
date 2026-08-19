export type CollectionRole = "owner" | "collaborator" | "viewer";
export type CollectionAccess = { canRead: boolean; canContribute: boolean; canManage: boolean };

export function normalizeCollection<T extends { role?: CollectionRole; access?: Partial<CollectionAccess> }>(collection: T): Omit<T, "role" | "access"> & { role: CollectionRole; access: CollectionAccess } {
  const role = collection.role ?? "owner";
  const defaults = role === "owner"
    ? { canRead: true, canContribute: true, canManage: true }
    : role === "collaborator"
      ? { canRead: true, canContribute: true, canManage: false }
      : { canRead: true, canContribute: false, canManage: false };
  return {
    ...collection,
    role,
    access: {
      canRead: collection.access?.canRead ?? defaults.canRead,
      canContribute: collection.access?.canContribute ?? defaults.canContribute,
      canManage: collection.access?.canManage ?? defaults.canManage,
    },
  };
}
