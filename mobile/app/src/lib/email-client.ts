import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().min(1);
const dateSchema = z.iso.datetime();
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
export type EmailContext = z.infer<typeof contextSchema>;
const EMAIL_RETURN_URI = "vorinthexcore://capability/signal";

export const emailFilterSchema = z.enum(["all", "important", "urgent", "needs_action", "filtered", "unread", "favorite"]);
export type EmailFilter = z.infer<typeof emailFilterSchema>;
export const emailInboxCategorySchema = z.enum(["Urgent", "Important", "Filtered"]);
export type EmailInboxCategory = z.infer<typeof emailInboxCategorySchema>;
export const emailToneSchema = z.string().trim().min(1).max(255);
export type EmailTone = z.infer<typeof emailToneSchema>;
export const BUILT_IN_EMAIL_TONES = ["casual", "formal", "concise"] as const;
const emailPersistedToneSlugSchema = z.enum(["casual", "formal", "concise", "warm", "direct"]);
export const emailToneRecordSchema = z.strictObject({
  key: keySchema,
  slug: emailPersistedToneSlugSchema.optional(),
  name: z.string().min(1),
  description: z.string().trim().min(1).max(10_000).optional(),
  instruction: z.string().trim().min(1).max(20_000),
  coverUrl: z.string().url().optional(),
  isFavorite: z.boolean(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});
export type EmailToneRecord = z.infer<typeof emailToneRecordSchema>;
export const emailReplyContextSchema = z.strictObject({
  key: keySchema,
  name: z.string().min(1).max(255),
  text: z.string().min(1).max(4_000),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});
export type EmailReplyContext = z.infer<typeof emailReplyContextSchema>;
export const emailReplyContextCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  text: z.string().trim().min(1).max(4_000),
});
export const emailReplyContextUpdateInputSchema = z.strictObject({
  noteKey: keySchema,
  name: z.string().trim().min(1).max(255).optional(),
  text: z.string().trim().min(1).max(4_000).optional(),
}).refine((value) => value.name !== undefined || value.text !== undefined, "Reply context changes are required.");
export const emailReplyContextDeleteInputSchema = z.strictObject({ noteKeys: z.array(keySchema).min(1).max(20) })
  .refine(({ noteKeys }) => new Set(noteKeys).size === noteKeys.length, "Reply context keys must be distinct.");
const emailReplyContextDeleteResultSchema = z.strictObject({ deletedKeys: z.array(keySchema) });
export const emailToneCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  instruction: z.string().trim().min(1).max(20_000),
  coverImageKey: keySchema.optional(),
  isFavorite: z.boolean().optional(),
});
export const emailToneUpdateInputSchema = z.strictObject({
  toneKey: keySchema,
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(10_000).nullable().optional(),
  instruction: z.string().trim().min(1).max(20_000).optional(),
  coverImageKey: keySchema.nullable().optional(),
  isFavorite: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined || value.instruction !== undefined || value.coverImageKey !== undefined || value.isFavorite !== undefined, "Tone metadata is required.");
export const emailAttachmentRefSchema = z.strictObject({ type: z.enum(["document", "image"]), key: keySchema });
export type EmailAttachmentRef = z.infer<typeof emailAttachmentRefSchema>;
const emailAddressListSchema = z.array(z.string().trim().email()).min(1).max(50);
export const emailReplyDraftInputSchema = z.strictObject({
  threadKey: keySchema,
  tone: emailToneSchema,
  instruction: z.string().trim().min(1).max(1_000).optional(),
  attachments: z.array(emailAttachmentRefSchema).max(20).optional(),
});
export const emailComposeDraftInputSchema = z.strictObject({
  connectorKey: keySchema.optional(),
  to: emailAddressListSchema,
  cc: z.array(z.string().trim().email()).max(50).optional(),
  bcc: z.array(z.string().trim().email()).max(50).optional(),
  subject: z.string().trim().min(1).max(998),
  tone: emailToneSchema,
  instruction: z.string().trim().min(1).max(1_000).optional(),
  attachments: z.array(emailAttachmentRefSchema).max(20).optional(),
});
export const emailAssignDraftInputSchema = z.strictObject({ draftKey: keySchema, connectorKey: keySchema });
export type EmailReplyDraftInput = z.infer<typeof emailReplyDraftInputSchema>;
export type EmailComposeDraftInput = z.infer<typeof emailComposeDraftInputSchema>;

export const emailConnectorSchema = z.strictObject({
  key: keySchema, connectorKey: keySchema, provider: z.literal("gmail"), email: z.string().email(), name: z.string().min(1), description: z.string().optional(), coverUrl: z.string().url().optional(), isFavorite: z.boolean(),
  status: z.enum(["active", "error", "revoked"]), syncEnabled: z.boolean(), syncStatus: z.enum(["idle", "syncing", "error"]), lastSyncedAt: dateSchema.optional(), syncError: z.string().optional(),
  createdAt: dateSchema, updatedAt: dateSchema,
});
export type EmailConnector = z.infer<typeof emailConnectorSchema>;
export const emailConnectionMetadataSchema = z.strictObject({ name: z.string().trim().min(1).max(255), description: z.string().trim().min(1).max(10_000).optional() });
export const emailInboxUpdateInputSchema = z.strictObject({
  connectorKey: keySchema,
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(10_000).nullable().optional(),
  coverImageKey: keySchema.nullable().optional(),
  isFavorite: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined || value.coverImageKey !== undefined || value.isFavorite !== undefined, "Inbox metadata is required.");
export const emailThreadSchema = z.strictObject({
  key: keySchema, scopeKey: keySchema, accountKey: keySchema, providerThreadId: z.string().min(1), subject: z.string().min(1), summary: z.string().min(1), intent: z.string().min(1), action: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]), state: z.enum(["needs_action", "waiting", "informational", "filtered", "done"]), lastMessageAt: dateSchema,
  snippet: z.string().optional(), category: z.enum(["primary", "updates", "promotions", "social", "forums", "other"]).optional(), unread: z.boolean().optional(), starred: z.boolean().optional(), labels: z.array(z.string()).optional(),
  latestFrom: z.string().email().optional(), inInbox: z.boolean().optional(), isFavorite: z.boolean(), inboxCategory: emailInboxCategorySchema,
  embeddingContentVersion: z.union([z.literal(2), z.literal(3)]).optional(), createdAt: dateSchema, updatedAt: dateSchema,
});
export const emailMessageSchema = z.strictObject({
  key: keySchema, scopeKey: keySchema, accountKey: keySchema, threadKey: keySchema, providerMessageId: z.string().min(1), from: z.string().email(), to: z.array(z.string().email()), cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1), body: z.string().min(1), summary: z.string().min(1), replyTo: z.string().email().optional(), messageIdHeader: z.string().optional(), inReplyTo: z.string().optional(), references: z.array(z.string()).optional(), parentMessageId: z.string().optional(), replyDepth: z.number().int().nonnegative().optional(), labels: z.array(z.string()).optional(), attachments: z.array(emailAttachmentRefSchema).optional(), direction: z.enum(["inbound", "outbound"]), sentAt: dateSchema, hasAttachments: z.boolean(), unread: z.boolean().optional(), inboxCategory: emailInboxCategorySchema, embeddingContentVersion: z.union([z.literal(2), z.literal(3)]).optional(), createdAt: dateSchema, updatedAt: dateSchema,
});
export const emailDraftSchema = z.object({
  key: keySchema, scopeKey: keySchema, variant: z.enum(["new", "reply"]), accountKey: keySchema.optional(), threadKey: keySchema.optional(), messageKey: keySchema.optional(), to: z.array(z.string().email()).optional(), cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(), subject: z.string().optional(), tone: emailToneSchema.optional(), instruction: z.string().optional(), attachments: z.array(emailAttachmentRefSchema).optional(), emailWritingProfileKey: keySchema.optional(), generatedContent: z.string().min(1), finalContent: z.string().optional(), providerMessageId: z.string().optional(), sendStartedAt: dateSchema.optional(), status: z.enum(["generated", "edited", "sending", "sent", "discarded"]), createdAt: dateSchema, updatedAt: dateSchema,
});

const overviewSchema = z.strictObject({
  accounts: z.array(emailConnectorSchema), selectedAccount: emailConnectorSchema.nullable(), threads: z.array(emailThreadSchema), drafts: z.array(emailDraftSchema),
  unassignedDrafts: z.array(emailDraftSchema).default([]),
  counts: z.strictObject({ all: z.number().int(), important: z.number().int(), urgent: z.number().int(), needsAction: z.number().int(), filtered: z.number().int(), unread: z.number().int(), favorite: z.number().int() }),
  nextCursor: z.string().min(1).nullable(),
});
const threadDetailSchema = z.strictObject({ thread: emailThreadSchema, messages: z.array(emailMessageSchema) });
export const emailTranslationVersionSchema = z.strictObject({
  key: keySchema, scopeKey: keySchema, documentKey: keySchema, version: z.number().int().positive(), type: z.literal("translation"), language: z.string().trim().min(1).max(100).optional(), label: z.string().trim().min(1).max(120).optional(), content: z.string().trim().min(1), embedding: z.array(z.number()), chunkEmbeddings: z.array(z.array(z.number())).optional(), semanticChunkCount: z.number().int().positive().optional(), semanticContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), _semanticChunkingSkipped: z.boolean().optional(), createdAt: dateSchema,
});
export const emailSummaryStyleSchema = z.enum(["brief", "detailed", "executive", "bullet-points", "technical"]);
export const emailSummarySchema = z.strictObject({
  key: keySchema, scopeKey: keySchema, documentKey: keySchema, version: z.number().int().positive(), summary: z.string().trim().min(1), topic: z.string().trim().min(1).optional(), style: emailSummaryStyleSchema, language: z.string().trim().min(1).optional(), sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/), sourceTitle: z.string().trim().min(1), sourceDocumentUpdatedAt: dateSchema, createdByKey: keySchema, createdAt: dateSchema,
});
export const emailSimilarResultSchema = emailMessageSchema.extend({ similarity: z.number().min(-1).max(1) }).strict();
const emailSimilarResponseSchema = z.strictObject({ messageKey: keySchema, items: z.array(emailSimilarResultSchema) });
const emailTranslationResponseSchema = z.strictObject({ messageKey: keySchema, language: z.string().min(1), version: emailTranslationVersionSchema });
const emailTranslationListResponseSchema = z.strictObject({ messageKey: keySchema, versions: z.array(emailTranslationVersionSchema) });
const emailSummaryResponseSchema = z.strictObject({ messageKey: keySchema, text: z.string().min(1), summary: emailSummarySchema });
const emailSummaryListResponseSchema = z.strictObject({ messageKey: keySchema, summaries: z.array(emailSummarySchema) });
const assistantResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.strictObject({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.strictObject({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
export type EmailOverview = z.infer<typeof overviewSchema>;
export type EmailThread = z.infer<typeof emailThreadSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type EmailTranslationVersion = z.infer<typeof emailTranslationVersionSchema>;
export type EmailSummaryStyle = z.infer<typeof emailSummaryStyleSchema>;
export type EmailSummary = z.infer<typeof emailSummarySchema>;
export type EmailSimilarResult = z.infer<typeof emailSimilarResultSchema>;

function recordKey(value: Record<string, unknown> | null) { return typeof value?.key === "string" ? value.key : ""; }
export function getEmailContext() {
  const state = useAuthStore.getState();
  const parsed = contextSchema.safeParse({ organizationKey: recordKey(state.organization), scopeKey: recordKey(state.scope) });
  if (!parsed.success) throw new Error("Email is unavailable for this session.");
  return parsed.data;
}

export function getEmailPermissions() {
  const state = useAuthStore.getState();
  const organizationRole = typeof state.organization?.role === "string" ? state.organization.role : "viewer";
  const scopeRole = typeof state.scope?.role === "string" ? state.scope.role : "viewer";
  return {
    canManageConnector: organizationRole === "owner" || organizationRole === "admin",
    canMutate: organizationRole === "owner" || organizationRole === "admin" || scopeRole === "owner" || scopeRole === "admin" || scopeRole === "moderator",
  };
}

function unwrap<T>(value: unknown, schema: z.ZodType<T>): T {
  const response = z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: schema }),
    z.object({ success: z.literal(false), error: z.object({ message: z.string().min(1) }) }),
  ]).parse(value);
  if (!response.success) throw new Error(response.error.message);
  return response.data;
}
function responseError(error: unknown) {
  const failure = (error as { response?: { data?: { success?: boolean; error?: { message?: string } } } }).response?.data;
  return failure?.success === false && typeof failure.error?.message === "string" ? new Error(failure.error.message) : error;
}
async function request<T>(method: "post" | "patch", path: string, body: Record<string, unknown>, schema: z.ZodType<T>) {
  return requestForContext(getEmailContext(), method, path, body, schema);
}
async function requestForContext<T>(context: EmailContext, method: "post" | "patch", path: string, body: Record<string, unknown>, schema: z.ZodType<T>, timeout?: number) {
  try {
    const response = await apiClient[method](path, { ...contextSchema.parse(context), ...body }, timeout ? { timeout } : undefined);
    return unwrap(response.data, schema);
  } catch (error) { throw responseError(error); }
}

export function fetchEmailOverview(input: { connectorKey?: string; filter?: EmailFilter; search?: string; cursor?: string; limit?: number } = {}) { return request("post", "/email/overview", input, overviewSchema); }
export function fetchEmailOverviewForContext(context: EmailContext, input: { connectorKey?: string; filter?: EmailFilter; search?: string; cursor?: string; limit?: number } = {}) { return requestForContext(context, "post", "/email/overview", input, overviewSchema); }
export async function syncEmail(connectorKey: string) {
  try {
    const response = await apiClient.post("/email/sync", { ...getEmailContext(), connectorKey: keySchema.parse(connectorKey) }, { timeout: 120_000 });
    return unwrap(response.data, z.object({ synced: z.number().int().nonnegative(), busy: z.boolean().optional(), lastSyncedAt: dateSchema.nullable() }));
  } catch (error) { throw responseError(error); }
}
export function sortEmailInboxForContext(context: EmailContext, connectorKey: string) { return requestForContext(context, "post", "/email/sort", { connectorKey: keySchema.parse(connectorKey) }, z.strictObject({ connectorKey: keySchema, threadsProcessed: z.number().int().nonnegative(), messagesProcessed: z.number().int().nonnegative() }), 30 * 60_000); }
export function subscribeEmail(connectorKey: string) { return request("post", "/email/subscribe", { connectorKey: keySchema.parse(connectorKey) }, z.object({ watchExpiresAt: dateSchema })); }
export function fetchEmailThread(threadKey: string) { return request("post", `/email/threads/${keySchema.parse(threadKey)}`, {}, threadDetailSchema); }
export function fetchEmailThreadForContext(context: EmailContext, threadKey: string) { return requestForContext(context, "post", `/email/threads/${keySchema.parse(threadKey)}`, {}, threadDetailSchema); }
export function setEmailThreadFavorite(threadKey: string, isFavorite: boolean) { return request("post", `/email/threads/${keySchema.parse(threadKey)}/favorite`, { isFavorite }, emailThreadSchema); }
export function trashEmailThreadForContext(context: EmailContext, threadKey: string) { return requestForContext(context, "post", `/email/threads/${keySchema.parse(threadKey)}/trash`, {}, emailThreadSchema); }
export function findSimilarEmailMessagesForContext(context: EmailContext, messageKey: string, input: { categories?: EmailInboxCategory[]; limit?: number } = {}) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/similar`, z.strictObject({ categories: z.array(emailInboxCategorySchema).min(1).max(3).optional(), limit: z.number().int().min(1).max(20).optional() }).parse(input), emailSimilarResponseSchema, 120_000); }
export function translateEmailMessageForContext(context: EmailContext, messageKey: string, input: { targetLanguage: string; sourceLanguage?: string }) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/translations`, z.strictObject({ targetLanguage: z.string().trim().min(2).max(100), sourceLanguage: z.string().trim().min(2).max(100).optional() }).parse(input), emailTranslationResponseSchema, 4 * 60_000); }
export function listEmailMessageTranslationsForContext(context: EmailContext, messageKey: string) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/translations/list`, {}, emailTranslationListResponseSchema); }
export function summarizeEmailMessageForContext(context: EmailContext, messageKey: string, input: { topic?: string; style?: EmailSummaryStyle; language?: string } = {}) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/summaries`, z.strictObject({ topic: z.string().trim().min(1).max(500).optional(), style: emailSummaryStyleSchema.optional(), language: z.string().trim().min(1).max(100).optional() }).parse(input), emailSummaryResponseSchema, 4 * 60_000); }
export function listEmailMessageSummariesForContext(context: EmailContext, messageKey: string) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/summaries/list`, {}, emailSummaryListResponseSchema); }
export function createEmailDraft(input: EmailReplyDraftInput) { return request("post", "/email/drafts", emailReplyDraftInputSchema.parse(input), emailDraftSchema); }
export function createEmailDraftForContext(context: EmailContext, input: EmailReplyDraftInput) { return requestForContext(context, "post", "/email/drafts", emailReplyDraftInputSchema.parse(input), emailDraftSchema); }
export function composeEmailDraft(input: EmailComposeDraftInput) { return request("post", "/email/drafts/compose", emailComposeDraftInputSchema.parse(input), emailDraftSchema); }
export function composeEmailDraftForContext(context: EmailContext, input: EmailComposeDraftInput) { return requestForContext(context, "post", "/email/drafts/compose", emailComposeDraftInputSchema.parse(input), emailDraftSchema); }
export function assignEmailDraft(draftKey: string, connectorKey: string) {
  const input = emailAssignDraftInputSchema.parse({ draftKey, connectorKey });
  return request("post", `/email/drafts/${input.draftKey}/assign`, { connectorKey: input.connectorKey }, emailDraftSchema);
}
export function updateEmailDraft(draftKey: string, finalContent: string) { return request("patch", `/email/drafts/${keySchema.parse(draftKey)}`, { finalContent }, emailDraftSchema); }
export function updateEmailDraftForContext(context: EmailContext, draftKey: string, finalContent: string) { return requestForContext(context, "patch", `/email/drafts/${keySchema.parse(draftKey)}`, { finalContent }, emailDraftSchema); }
export function sendEmailDraft(draftKey: string) { return request("post", `/email/drafts/${keySchema.parse(draftKey)}/send`, {}, z.object({ sent: z.literal(true), providerMessageId: z.string().min(1), draftKey: keySchema.optional(), threadKey: keySchema.optional() })); }
export function sendEmailDraftForContext(context: EmailContext, draftKey: string) { return requestForContext(context, "post", `/email/drafts/${keySchema.parse(draftKey)}/send`, {}, z.object({ sent: z.literal(true), providerMessageId: z.string().min(1), draftKey: keySchema.optional(), threadKey: keySchema.optional() })); }
export function fetchEmailTones() { return request("post", "/email/tones/list", {}, z.array(emailToneRecordSchema)); }
export function fetchEmailTonesForContext(context: EmailContext) { return requestForContext(context, "post", "/email/tones/list", {}, z.array(emailToneRecordSchema)); }
export function createEmailTone(input: z.input<typeof emailToneCreateInputSchema>) { return request("post", "/email/tones", emailToneCreateInputSchema.parse(input), emailToneRecordSchema); }
export function createEmailToneForContext(context: EmailContext, input: z.input<typeof emailToneCreateInputSchema>) { return requestForContext(context, "post", "/email/tones", emailToneCreateInputSchema.parse(input), emailToneRecordSchema); }
export function updateEmailTone(input: z.input<typeof emailToneUpdateInputSchema>) {
  const { toneKey, ...body } = emailToneUpdateInputSchema.parse(input);
  return request("patch", `/email/tones/${encodeURIComponent(toneKey)}`, body, emailToneRecordSchema);
}
export function updateEmailToneForContext(context: EmailContext, input: z.input<typeof emailToneUpdateInputSchema>) {
  const { toneKey, ...body } = emailToneUpdateInputSchema.parse(input);
  return requestForContext(context, "patch", `/email/tones/${encodeURIComponent(toneKey)}`, body, emailToneRecordSchema);
}
export function fetchEmailReplyContextsForContext(context: EmailContext) { return requestForContext(context, "post", "/email/reply-context/list", {}, z.array(emailReplyContextSchema)); }
export function createEmailReplyContextForContext(context: EmailContext, input: z.input<typeof emailReplyContextCreateInputSchema>) {
  return requestForContext(context, "post", "/email/reply-context", emailReplyContextCreateInputSchema.parse(input), emailReplyContextSchema);
}
export function updateEmailReplyContextForContext(context: EmailContext, input: z.input<typeof emailReplyContextUpdateInputSchema>) {
  const { noteKey, ...body } = emailReplyContextUpdateInputSchema.parse(input);
  return requestForContext(context, "patch", `/email/reply-context/${encodeURIComponent(noteKey)}`, body, emailReplyContextSchema);
}
export async function deleteEmailReplyContextsForContext(context: EmailContext, noteKeys: string[]) {
  const input = emailReplyContextDeleteInputSchema.parse({ noteKeys });
  const result = await requestForContext(context, "post", "/email/reply-context/delete", input, emailReplyContextDeleteResultSchema);
  const requested = new Set(input.noteKeys);
  return { deletedNoteKeys: [...new Set(result.deletedKeys.filter((key) => requested.has(key)))] };
}
export function updateEmailInbox(input: z.input<typeof emailInboxUpdateInputSchema>) { return request("patch", "/email/inboxes", emailInboxUpdateInputSchema.parse(input), emailConnectorSchema); }
export function updateEmailInboxForContext(context: EmailContext, input: z.input<typeof emailInboxUpdateInputSchema>) { return requestForContext(context, "patch", "/email/inboxes", emailInboxUpdateInputSchema.parse(input), emailConnectorSchema); }
export function disconnectEmail(connectorKey: string) { return request("post", "/email/disconnect", { connectorKey: keySchema.parse(connectorKey) }, z.object({ disconnected: z.literal(true) })); }
export async function askEmailAssistant(message: string, requestKey: string) {
  const { organizationKey, scopeKey } = getEmailContext();
  try {
    const response = await apiClient.post("/assistant/respond", {
      organizationKey,
      scopeKey,
      input: { surface: "signal-workspace", requestKey: z.string().trim().min(1).max(180).parse(requestKey), message: z.string().trim().min(1).max(8_000).parse(message), currentNote: { title: "", content: "" } },
    }, { timeout: 4 * 60_000 });
    return unwrap(response.data, assistantResponseSchema);
  } catch (error) { throw responseError(error); }
}

const connectionExchanges = new Map<string, Promise<EmailConnector>>();
export function exchangeEmailConnection(code: string) {
  const existing = connectionExchanges.get(code);
  if (existing) return existing;
  const operation = request("post", "/email/connect/exchange", { code }, emailConnectorSchema).catch((error: unknown) => { connectionExchanges.delete(code); throw error; });
  connectionExchanges.set(code, operation);
  return operation;
}

export async function launchEmailConnection(metadata: z.input<typeof emailConnectionMetadataSchema>) {
  const input = emailConnectionMetadataSchema.parse(metadata);
  const start = await request("post", "/email/connect", { returnUri: EMAIL_RETURN_URI, ...input }, z.object({ authorizationUrl: z.string().url() }));
  const result = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, EMAIL_RETURN_URI);
  if (result.type !== "success") return null;
  const params = Linking.parse(result.url).queryParams ?? {};
  const error = typeof params.email_connection_error === "string" ? params.email_connection_error : null;
  const code = typeof params.email_connection_code === "string" ? params.email_connection_code : null;
  if (error) throw new Error("Gmail connection was not completed.");
  if (!code) throw new Error("Google returned an incomplete connection response.");
  return exchangeEmailConnection(code);
}
