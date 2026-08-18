import { apiClient } from "@/lib/api-client";

export const USER_HIDDEN_SOURCES = ["collection", "document", "image", "folder"] as const;
export type UserHiddenSource = (typeof USER_HIDDEN_SOURCES)[number];
export type UserHiddenRecord = {
  key: string;
  userKey: string;
  source: UserHiddenSource;
  sourceKey: string;
  createdAt: string;
};
export type HiddenViewMode = "normal" | "favorites" | "hidden";

export async function listUserHiddens() {
  return (await apiClient.get<UserHiddenRecord[]>("/auth/me/hiddens")).data;
}

export async function hideUserSource(source: UserHiddenSource, sourceKey: string) {
  return (await apiClient.post<UserHiddenRecord>("/auth/me/hiddens", { source, sourceKey })).data;
}

export async function revealUserSource(source: UserHiddenSource, sourceKey: string) {
  return (await apiClient.delete<UserHiddenRecord | null>("/auth/me/hiddens", { params: { source, sourceKey } })).data;
}

export function hiddenSourceFor(kind: UserHiddenSource | "file"): UserHiddenSource {
  return kind === "file" ? "document" : kind;
}

export function isUserHidden(records: readonly UserHiddenRecord[], source: UserHiddenSource | "file", sourceKey: string) {
  const normalizedSource = hiddenSourceFor(source);
  return records.some((record) => record.source === normalizedSource && record.sourceKey === sourceKey);
}

export function filterByHiddenView<T extends { isFavorite?: boolean }>(
  items: readonly T[],
  records: readonly UserHiddenRecord[],
  source: UserHiddenSource | "file",
  mode: HiddenViewMode,
  keyOf: (item: T) => string = (item) => (item as T & { key: string }).key,
) {
  return items.filter((item) => {
    const hidden = isUserHidden(records, source, keyOf(item));
    if (mode === "hidden") return hidden;
    if (hidden) return false;
    return mode !== "favorites" || item.isFavorite === true;
  });
}
