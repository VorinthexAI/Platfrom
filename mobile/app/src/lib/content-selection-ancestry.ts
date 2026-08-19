export type FolderAncestorRecord = {
  key: string;
  parentFolderKey?: string;
};

export type FolderDocumentRecord = {
  key: string;
  folderKey?: string;
};

export function partitionFavoriteContentSelection<F extends { isFavorite?: boolean }, D extends { isFavorite?: boolean }>(folders: readonly F[], documents: readonly D[]) {
  return {
    favoriteFolders: folders.filter(({ isFavorite }) => Boolean(isFavorite)),
    favoriteDocuments: documents.filter(({ isFavorite }) => Boolean(isFavorite)),
    eligibleFolders: folders.filter(({ isFavorite }) => !isFavorite),
    eligibleDocuments: documents.filter(({ isFavorite }) => !isFavorite),
  };
}

export function removeFoldersCoveredBySelectedAncestors<T extends FolderAncestorRecord>(folders: readonly T[], parentByKey: ReadonlyMap<string, string | undefined>) {
  const selectedKeys = new Set(folders.map(({ key }) => key));
  return folders.filter((folder) => {
    let parentKey = parentByKey.has(folder.key) ? parentByKey.get(folder.key) : folder.parentFolderKey;
    const visited = new Set<string>();
    while (parentKey && !visited.has(parentKey)) {
      if (selectedKeys.has(parentKey)) return false;
      visited.add(parentKey);
      parentKey = parentByKey.get(parentKey);
    }
    return true;
  });
}

export function normalizeStructurallyCoveredResources<F extends FolderAncestorRecord, D extends FolderDocumentRecord>(folders: readonly F[], documents: readonly D[], parentByKey: ReadonlyMap<string, string | undefined>) {
  const selectedFolderKeys = new Set(folders.map(({ key }) => key));
  const isCovered = (startingFolderKey?: string) => {
    let folderKey = startingFolderKey;
    const visited = new Set<string>();
    while (folderKey && !visited.has(folderKey)) {
      if (selectedFolderKeys.has(folderKey)) return true;
      visited.add(folderKey);
      folderKey = parentByKey.get(folderKey);
    }
    return false;
  };
  return {
    folders: removeFoldersCoveredBySelectedAncestors(folders, parentByKey),
    documents: documents.filter((document) => !isCovered(document.folderKey)),
  };
}
