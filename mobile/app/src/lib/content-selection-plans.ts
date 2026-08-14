export const MAX_CONTENT_BATCH_OPERATIONS = 100;

export type ContentSelection = {
  folderKeys: readonly string[];
  documentKeys: readonly string[];
};

export type ContentSelectionOperation = {
  kind: "folder" | "document";
  key: string;
  destinationFolderKey?: string;
};

export type ContentSelectionPlanCall = {
  tool: "folder.update" | "document.update" | "folder.move" | "document.move" | "folder.copy" | "document.copy" | "folder.archive" | "document.archive";
  input: Record<string, unknown>;
  operations: ContentSelectionOperation[];
};

export type ContentSelectionPlan = {
  operationCount: number;
  calls: ContentSelectionPlanCall[];
};

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function normalizedSelection(selection: ContentSelection) {
  return { folderKeys: unique(selection.folderKeys), documentKeys: unique(selection.documentKeys) };
}

function assertBatchSize(count: number, tool: ContentSelectionPlanCall["tool"]) {
  if (count > MAX_CONTENT_BATCH_OPERATIONS) throw new Error(`${tool} operations cannot exceed ${MAX_CONTENT_BATCH_OPERATIONS}.`);
}

function stableHash(value: string, seed: number) {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function operationKey(idempotencyKey: string, tool: ContentSelectionPlanCall["tool"]) {
  const key = `${idempotencyKey}:${tool}`;
  if (key.length <= 200) return key;
  const digest = `${stableHash(idempotencyKey, 2_166_136_261)}${stableHash(idempotencyKey, 3_332_666_117)}`;
  const suffix = `:${digest}:${tool}`;
  return `${idempotencyKey.slice(0, 200 - suffix.length)}${suffix}`;
}

function assertDestinationKey(destinationFolderKey: string | undefined) {
  if (destinationFolderKey !== undefined && destinationFolderKey.trim().length === 0) throw new Error("Archive destination keys cannot be empty.");
}

function plan(calls: ContentSelectionPlanCall[]): ContentSelectionPlan {
  return { operationCount: calls.reduce((count, call) => count + call.operations.length, 0), calls };
}

export function planContentSelectionFavorite(selection: ContentSelection, isFavorite: boolean, idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, documentKeys } = normalizedSelection(selection);
  assertBatchSize(folderKeys.length, "folder.update");
  assertBatchSize(documentKeys.length, "document.update");
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.update",
    input: { updates: folderKeys.map((folderKey) => ({ folderKey, isFavorite })), atomic: false, idempotencyKey: operationKey(idempotencyKey, "folder.update") },
    operations: folderKeys.map((key) => ({ kind: "folder", key })),
  });
  if (documentKeys.length) calls.push({
    tool: "document.update",
    input: { updates: documentKeys.map((documentKey) => ({ documentKey, isFavorite })), atomic: false, idempotencyKey: operationKey(idempotencyKey, "document.update") },
    operations: documentKeys.map((key) => ({ kind: "document", key })),
  });
  return plan(calls);
}

export function planContentSelectionMove(selection: ContentSelection, targetScopeKey: string, targetFolderKey: string | undefined, idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, documentKeys } = normalizedSelection(selection);
  assertDestinationKey(targetFolderKey);
  assertBatchSize(folderKeys.length, "folder.move");
  assertBatchSize(documentKeys.length, "document.move");
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.move",
    input: { moves: folderKeys.map((folderKey) => ({ folderKey, ...(targetFolderKey ? { targetParentFolderKey: targetFolderKey } : {}) })), atomic: false, idempotencyKey: operationKey(idempotencyKey, "folder.move") },
    operations: folderKeys.map((key) => ({ kind: "folder", key, destinationFolderKey: targetFolderKey })),
  });
  if (documentKeys.length) calls.push({
    tool: "document.move",
    input: { moves: documentKeys.map((documentKey) => ({ documentKey, targetScopeKey, ...(targetFolderKey ? { targetFolderKey } : {}) })), atomic: false, idempotencyKey: operationKey(idempotencyKey, "document.move") },
    operations: documentKeys.map((key) => ({ kind: "document", key, destinationFolderKey: targetFolderKey })),
  });
  return plan(calls);
}

export function planContentSelectionCopy(selection: ContentSelection, targetScopeKey: string, destinationFolderKeys: readonly (string | undefined)[], idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, documentKeys } = normalizedSelection(selection);
  destinationFolderKeys.forEach(assertDestinationKey);
  const destinations = [...new Map(destinationFolderKeys.map((key) => [key ?? null, key])).values()];
  if ((folderKeys.length || documentKeys.length) && !destinations.length) throw new Error("At least one Archive copy destination is required.");
  const calls: ContentSelectionPlanCall[] = [];
  const folderOperations = folderKeys.flatMap((key) => destinations.map((destinationFolderKey) => ({ kind: "folder" as const, key, destinationFolderKey })));
  const documentOperations = documentKeys.flatMap((key) => destinations.map((destinationFolderKey) => ({ kind: "document" as const, key, destinationFolderKey })));
  assertBatchSize(folderOperations.length, "folder.copy");
  assertBatchSize(documentOperations.length, "document.copy");
  if (folderOperations.length) calls.push({
    tool: "folder.copy",
    input: { copies: folderOperations.map(({ key: folderKey, destinationFolderKey }) => ({ folderKey, targetScopeKey, ...(destinationFolderKey ? { targetParentFolderKey: destinationFolderKey } : {}) })), atomic: false, idempotencyKey: operationKey(idempotencyKey, "folder.copy") },
    operations: folderOperations,
  });
  if (documentOperations.length) calls.push({
    tool: "document.copy",
    input: { copies: documentOperations.map(({ key: documentKey, destinationFolderKey }) => ({ documentKey, targetScopeKey, ...(destinationFolderKey ? { targetFolderKey: destinationFolderKey } : {}), includeVersions: false, includeShares: false })), atomic: false, idempotencyKey: operationKey(idempotencyKey, "document.copy") },
    operations: documentOperations,
  });
  return plan(calls);
}

export function planContentSelectionArchive(selection: ContentSelection, idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, documentKeys } = normalizedSelection(selection);
  assertBatchSize(folderKeys.length, "folder.archive");
  assertBatchSize(documentKeys.length, "document.archive");
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.archive",
    input: { folderKeys, includeDescendants: true, atomic: false, idempotencyKey: operationKey(idempotencyKey, "folder.archive") },
    operations: folderKeys.map((key) => ({ kind: "folder", key })),
  });
  if (documentKeys.length) calls.push({
    tool: "document.archive",
    input: { documentKeys, atomic: false, idempotencyKey: operationKey(idempotencyKey, "document.archive") },
    operations: documentKeys.map((key) => ({ kind: "document", key })),
  });
  return plan(calls);
}
