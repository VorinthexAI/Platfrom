import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = readFileSync(join(import.meta.dir, "../components/capability/EmailWorkspace.tsx"), "utf8");
const highlights = readFileSync(join(import.meta.dir, "../components/capability/GalleryHighlights.tsx"), "utf8");
const client = readFileSync(join(import.meta.dir, "email-client.ts"), "utf8");
const backendRoutes = readFileSync(join(import.meta.dir, "../../../../backend/src/api/routes.ts"), "utf8");
const backendHandlers = readFileSync(join(import.meta.dir, "../../../../backend/src/api/email-inbox.ts"), "utf8");

function style(source: string, name: string) {
  const match = source.match(new RegExp(`${name}: \\{([^\\n]+)\\}`));
  expect(match, `${name} style exists`).not.toBeNull();
  return match![1];
}

test("generated bulk toolbars retain Gallery styling with sheet-safe controls", () => {
  expect(style(workspace, "generatedBulkToolbar")).toBe(style(highlights, "bulkToolbar"));
  expect(style(workspace, "generatedBulkToolbarSelection")).toBe(style(highlights, "bulkToolbarSelection"));
  expect(style(workspace, "generatedBulkToolbarClose")).toContain("height: 42, width: 42");
  expect(style(workspace, "generatedBulkSelectionText")).toBe(style(highlights, "bulkSelectionText"));
  expect(style(workspace, "generatedBulkDeleteAction")).not.toContain("height: 30");
  expect(style(workspace, "generatedBulkDeleteText")).toBe(style(highlights, "bulkDeleteText"));
  expect(style(workspace, "generatedVersionSelected")).toBe(style(highlights, "cardSelected"));
  expect(style(workspace, "generatedSelectionBadge")).toBe(style(highlights, "selectionBadge"));
  expect(workspace).toContain('<CheckIcon size="sm" variant="inverse" />');
  expect(workspace).toContain('accessibilityLiveRegion="polite"');
  expect(workspace).toContain('variant="secondary">Delete</Button>');
});

test("generated selection is mutator-only, bounded, accessible, and suppresses synthetic presses", () => {
  expect(workspace).toContain('onLongPress={permissions.canMutate ? () => handleGeneratedLongPress("translation", version.key) : undefined}');
  expect(workspace).toContain('onLongPress={permissions.canMutate ? () => handleGeneratedLongPress("summary", summary.key) : undefined}');
  expect(workspace).toContain('accessibilityActions={permissions.canMutate ? [{ name: "longpress"');
  expect(workspace).toContain('if (nativeEvent.actionName === "longpress") toggleGeneratedSelection');
  expect(workspace).toContain('if (current.length >= 50)');
  expect(workspace).toContain('You can select up to 50 saved versions.');
  expect(workspace).toContain('setTimeout(() => { if (longPressedGenerated.current === `${kind}:${key}`) longPressedGenerated.current = undefined; }, 50)');
  expect(workspace).toContain('if (longPress === token) return;');
  expect(workspace).toContain('void Haptics.selectionAsync()');
  expect(workspace).toContain('if (selection.length && permissions.canMutate) toggleGeneratedSelection(kind, key)');
  expect(workspace).toContain('permissions.canMutate && selectedTranslationKeys.length ? <Tabs');
  expect(workspace).toContain('permissions.canMutate && selectedSummaryKeys.length ? <Tabs');
  expect(workspace).toContain('if (permissions.canMutate) return;');
  expect(workspace).not.toContain("<Pressable");
});

test("generated deletion confirms permanent bulk removal without mutation spinners", () => {
  expect(workspace).toContain('type GeneratedDeleteConfirmation = Readonly<');
  expect(workspace).toContain('keys: Object.freeze([...keys])');
  expect(workspace).toContain('This permanently deletes the selected saved');
  expect(workspace).toContain('This cannot be undone.');
  expect(workspace).toContain('generatedDeleteConfirmation.keys.length === 1 ? generatedDeleteConfirmation.kind');
  expect(workspace).toContain('onPress={() => void deleteGeneratedRecords()} size="md" variant="danger">Delete</Button>');
  expect(workspace).toContain('size="md" variant="secondary">Close</Button>');
  const operation = workspace.slice(workspace.indexOf("async function deleteGeneratedRecords"), workspace.indexOf("function openReaderFlow"));
  expect(operation).not.toContain("loading=");
  expect(operation).toContain("generatedDeleteInFlight.current");
  expect(operation).toContain("const requestKey = randomUUID()");
  expect(operation).toContain("cancelQueries({ queryKey, exact: true })");
  const optimisticRemoval = operation.indexOf("removeSignalTranslationVersions");
  const optimisticClose = operation.indexOf("setGeneratedDeleteConfirmation(undefined)", optimisticRemoval);
  expect(optimisticRemoval).toBeLessThan(optimisticClose);
  expect(optimisticClose).toBeLessThan(operation.indexOf("await deleteEmailMessage"));
  expect(operation.indexOf("notify(`${requestedKeys.length}")).toBeLessThan(operation.indexOf("await deleteEmailMessage"));
  expect(operation).toContain("restoreMissingSignalTranslationVersions");
  expect(operation).toContain("restoreMissingSignalSummaries");
  expect(operation).toContain("setGeneratedSelection(operation.kind, failedKeys)");
  expect(operation).toContain('invalidateQueries({ queryKey, exact: true, refetchType: "active" })');
  expect(operation).toContain("selectedThreadKeyRef.current === operation.threadKey");
  expect(operation).toContain("selectedMessageKeyRef.current === operation.messageKey");
  expect(operation).toContain("operation.generation === generatedDeleteGeneration.current");
});

test("generated lists use active exact caches and key-derived readers", () => {
  expect(workspace).toContain("const translationQuery = useQuery({");
  expect(workspace).toContain("const summaryQuery = useQuery({");
  expect(workspace).toContain("const selectedTranslation = translations.find(({ key }) => key === selectedTranslationKey)");
  expect(workspace).toContain("const selectedSummary = summaries.find(({ key }) => key === selectedSummaryKey)");
  expect(workspace).not.toContain("setSelectedTranslation(version)");
  expect(workspace).not.toContain("setSelectedSummary(summary)");
  expect(workspace).toContain('if (readerSheet === "translationReader" && selectedTranslationKey && !selectedTranslation)');
  expect(workspace).toContain('if (readerSheet === "summaryReader" && selectedSummaryKey && !selectedSummary)');
  expect(workspace).toContain("clearGeneratedReaderState();");
});

test("generated deletion clients use the exact strict idempotent backend contracts", () => {
  const contracts = [
    { suffix: "translations", handler: "deleteMessageTranslations", keys: "translationKeys" },
    { suffix: "summaries", handler: "deleteMessageSummaries", keys: "summaryKeys" },
  ] as const;
  for (const contract of contracts) {
    const route = `/email/messages/:messageKey/${contract.suffix}`;
    expect(backendRoutes).toContain(`app.delete('${route}', emailHandlers.${contract.handler})`);
    const handlerStart = backendHandlers.indexOf(`${contract.handler}: run(`);
    const handlerEnd = backendHandlers.indexOf("\n", handlerStart);
    const handler = backendHandlers.slice(handlerStart, handlerEnd);
    expect(handler).toContain(`${contract.keys}: emailMessage`);
    expect(handler).toContain("messageKey: c.req.param('messageKey')");
    expect(client).toContain(`requestForContext(context, "delete", \`/email/messages/\${messageKey}/${contract.suffix}\`, { ${contract.keys} }`);
  }
  expect(client).not.toContain("/email/message-translations/delete");
  expect(client).not.toContain("/email/message-summaries/delete");
  expect(client).toContain("emailTranslationDeleteInputSchema");
  expect(client).toContain("emailSummaryDeleteInputSchema");
  expect(client).toContain("emailGeneratedDeleteResultSchema");
  expect(client).toContain("idempotencyKey);");
});
