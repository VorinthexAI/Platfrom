export const MAX_CONTENT_BATCH_OPERATIONS = 100;

export type ContentSelection = {
  folderKeys: readonly string[];
  fileKeys: readonly string[];
};

export type ContentSelectionOperation = {
  kind: "folder" | "file";
  key: string;
  destinationFolderKey?: string;
};

export type ContentSelectionPlanCall = {
  tool: "folder.update" | "file.update" | "folder.move" | "file.move" | "folder.copy" | "file.copy" | "folder.delete" | "file.delete";
  inputFor: (operation: ContentSelectionOperation) => Record<string, unknown>;
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
  return { folderKeys: unique(selection.folderKeys), fileKeys: unique(selection.fileKeys) };
}

function assertBatchSize(count: number) {
  if (count > MAX_CONTENT_BATCH_OPERATIONS) throw new Error(`Content operations cannot exceed ${MAX_CONTENT_BATCH_OPERATIONS}.`);
}

function plan(calls: ContentSelectionPlanCall[]): ContentSelectionPlan {
  return { operationCount: calls.reduce((count, call) => count + call.operations.length, 0), calls };
}

export function planContentSelectionFavorite(selection: ContentSelection, isFavorite: boolean, _idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, fileKeys } = normalizedSelection(selection);
  assertBatchSize(folderKeys.length + fileKeys.length);
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.update",
    inputFor: (operation) => ({ folderKey: operation.key, isFavorite }),
    operations: folderKeys.map((key) => ({ kind: "folder", key })),
  });
  if (fileKeys.length) calls.push({
    tool: "file.update",
    inputFor: (operation) => ({ fileKey: operation.key, isFavorite }),
    operations: fileKeys.map((key) => ({ kind: "file", key })),
  });
  return plan(calls);
}

export function planContentSelectionMove(selection: ContentSelection, targetFolderKey: string | undefined, _idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, fileKeys } = normalizedSelection(selection);
  assertBatchSize(folderKeys.length + fileKeys.length);
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.move",
    inputFor: (operation) => ({ folderKey: operation.key, parentFolderKey: targetFolderKey ?? null }),
    operations: folderKeys.map((key) => ({ kind: "folder", key, destinationFolderKey: targetFolderKey })),
  });
  if (fileKeys.length) calls.push({
    tool: "file.move",
    inputFor: (operation) => ({ fileKey: operation.key, folderKey: targetFolderKey ?? null }),
    operations: fileKeys.map((key) => ({ kind: "file", key, destinationFolderKey: targetFolderKey })),
  });
  return plan(calls);
}

export function planContentSelectionCopy(selection: ContentSelection, targetFolderKey: string | undefined, _idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, fileKeys } = normalizedSelection(selection);
  assertBatchSize(folderKeys.length + fileKeys.length);
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.copy",
    inputFor: (operation) => ({ folderKey: operation.key, parentFolderKey: targetFolderKey ?? null }),
    operations: folderKeys.map((key) => ({ kind: "folder", key, destinationFolderKey: targetFolderKey })),
  });
  if (fileKeys.length) calls.push({
    tool: "file.copy",
    inputFor: (operation) => ({ fileKey: operation.key, folderKey: targetFolderKey ?? null }),
    operations: fileKeys.map((key) => ({ kind: "file", key, destinationFolderKey: targetFolderKey })),
  });
  return plan(calls);
}

export function planContentSelectionDelete(selection: ContentSelection, _idempotencyKey: string): ContentSelectionPlan {
  const { folderKeys, fileKeys } = normalizedSelection(selection);
  assertBatchSize(folderKeys.length + fileKeys.length);
  const calls: ContentSelectionPlanCall[] = [];
  if (folderKeys.length) calls.push({
    tool: "folder.delete",
    inputFor: (operation) => ({ folderKey: operation.key }),
    operations: folderKeys.map((key) => ({ kind: "folder", key })),
  });
  if (fileKeys.length) calls.push({
    tool: "file.delete",
    inputFor: (operation) => ({ fileKey: operation.key }),
    operations: fileKeys.map((key) => ({ kind: "file", key })),
  });
  return plan(calls);
}
