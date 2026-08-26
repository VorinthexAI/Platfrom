import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { z } from "zod";
import { appSearchResults, searchApp } from "@/lib/app-search-client";

import { apiClient } from "@/lib/api-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().min(1);
const dateSchema = z.iso.datetime();
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
export type EmailContext = z.infer<typeof contextSchema>;
const EMAIL_RETURN_URI = "https://vorinthex.com/capability/signal";

export const emailFilterSchema = z.enum(["all", "important", "urgent", "needs_action", "filtered", "unread", "favorite", "trash"]);
export type EmailFilter = z.infer<typeof emailFilterSchema>;
export const emailReadStateSchema = z.enum(["read", "unread"]);
export type EmailReadState = z.infer<typeof emailReadStateSchema>;
export const emailFacetSchema = z.enum(["urgent", "important", "filtered", "favorite"]);
export type EmailFacet = z.infer<typeof emailFacetSchema>;
const EMAIL_FACET_ORDER: readonly EmailFacet[] = ["urgent", "important", "filtered", "favorite"];
export type EmailOverviewQuery = Readonly<{ readState: EmailReadState; facets: readonly EmailFacet[]; search: string }>;
export function normalizeEmailOverviewQuery(input: { readState?: EmailReadState; facets?: readonly EmailFacet[]; search?: string } = {}): EmailOverviewQuery {
  const selected = new Set(input.facets ?? ["urgent", "important"]);
  return Object.freeze({
    readState: emailReadStateSchema.parse(input.readState ?? "unread"),
    facets: Object.freeze(EMAIL_FACET_ORDER.filter((facet) => selected.has(facet))),
    search: input.search?.trim() ?? "",
  });
}
export function setEmailOverviewReadState(query: EmailOverviewQuery, readState: EmailReadState): EmailOverviewQuery {
  return normalizeEmailOverviewQuery({ ...query, readState });
}
export function toggleEmailOverviewFacet(query: EmailOverviewQuery, facet: EmailFacet): EmailOverviewQuery {
  const facets = query.facets.includes(facet) ? query.facets.filter((candidate) => candidate !== facet) : [...query.facets, facet];
  return normalizeEmailOverviewQuery({ ...query, facets });
}
export const emailOverviewInputSchema = z.strictObject({
  connectorKey: keySchema.optional(),
  filter: emailFilterSchema.optional(),
  readState: emailReadStateSchema.optional(),
  facets: z.array(emailFacetSchema).max(4).optional(),
  search: z.string().trim().max(200).optional(),
  cursor: z.string().min(1).max(2_000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).superRefine((value, context) => {
  const hasCompositeField = value.readState !== undefined || value.facets !== undefined;
  if (value.filter !== undefined && hasCompositeField) context.addIssue({ code: "custom", message: "filter cannot be combined with composite overview fields" });
  if (hasCompositeField && (value.readState === undefined || value.facets === undefined)) context.addIssue({ code: "custom", message: "readState and facets must be provided together" });
  if (!value.connectorKey && (value.filter !== undefined || hasCompositeField || value.search !== undefined || value.cursor !== undefined || value.limit !== undefined)) context.addIssue({ code: "custom", message: "connectorKey is required for an overview query" });
}).transform((value) => {
  if (value.filter || !value.readState && !value.facets) return value;
  const normalized = normalizeEmailOverviewQuery(value);
  return { ...value, readState: normalized.readState, facets: [...normalized.facets] };
});
export const emailInboxCategorySchema = z.enum(["Urgent", "Important", "Filtered"]);
export type EmailInboxCategory = z.infer<typeof emailInboxCategorySchema>;
export const emailToneSchema = z.string().trim().min(1).max(255);
export type EmailTone = z.infer<typeof emailToneSchema>;
export const BUILT_IN_EMAIL_TONES = ["casual", "formal", "direct"] as const;
const emailPersistedToneSlugSchema = z.enum(["casual", "formal", "concise", "warm", "direct"]);
export const emailToneRecordSchema = z.strictObject({
  key: keySchema,
  slug: emailPersistedToneSlugSchema.optional(),
  name: z.string().min(1),
  instruction: z.string().trim().min(1).max(20_000),
  isFavorite: z.boolean(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});
export type EmailToneRecord = z.infer<typeof emailToneRecordSchema>;
const emailSemanticSearchInputSchema = z.strictObject({ query: z.string().trim().min(1).max(500), minimumScore: z.number().min(-1).max(1).default(0.55), limit: z.number().int().min(1).max(50).default(50), recordHistory: z.boolean().default(true) });
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
  instruction: z.string().trim().min(1).max(20_000),
  isFavorite: z.boolean().optional(),
});
export const emailToneUpdateInputSchema = z.strictObject({
  toneKey: keySchema,
  name: z.string().trim().min(1).max(255).optional(),
  instruction: z.string().trim().min(1).max(20_000).optional(),
  isFavorite: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.instruction !== undefined || value.isFavorite !== undefined, "Tone metadata is required.");
export const emailAttachmentRefSchema = z.strictObject({ type: z.enum(["document", "image"]), key: keySchema });
export type EmailAttachmentRef = z.infer<typeof emailAttachmentRefSchema>;
export const emailAttachmentRefsSchema = z.array(emailAttachmentRefSchema).max(20)
  .refine((refs) => new Set(refs.map(({ type, key }) => `${type}:${key}`)).size === refs.length, "Attachment references must be distinct.");
export type EmailRetainedRequestKey = Readonly<{ fingerprint: string; requestKey: string }>;
export function retainEmailRequestKey(current: EmailRetainedRequestKey | undefined, fingerprint: string, createRequestKey: () => string): EmailRetainedRequestKey {
  return current?.fingerprint === fingerprint ? current : Object.freeze({ fingerprint, requestKey: createRequestKey() });
}
export const emailDraftUpdateInputSchema = z.strictObject({
  finalContent: z.string().max(50_000).optional(),
  attachments: emailAttachmentRefsSchema.optional(),
}).refine((input) => input.finalContent !== undefined || input.attachments !== undefined, "Draft content or attachments are required.");
export type EmailDraftUpdateInput = z.infer<typeof emailDraftUpdateInputSchema>;
export const emailReplyModeSchema = z.enum(["reply", "reply_all"]);
export type EmailReplyMode = z.infer<typeof emailReplyModeSchema>;
export const emailAddressSchema = z.string().trim().email();
export const emailAddressListSchema = z.array(emailAddressSchema).min(1).max(50);
export const emailReplyDraftInputSchema = z.strictObject({
  threadKey: keySchema,
  replyMode: emailReplyModeSchema,
  tone: emailToneSchema,
  instruction: z.string().trim().min(1).max(1_000).optional(),
  attachments: emailAttachmentRefsSchema.optional(),
});
export const emailComposeDraftInputSchema = z.strictObject({
  connectorKey: keySchema.optional(),
  to: emailAddressListSchema,
  cc: z.array(emailAddressSchema).max(50).optional(),
  bcc: z.array(emailAddressSchema).max(50).optional(),
  generationMode: z.enum(["generate", "preserve"]).default("generate"),
  subject: z.string().max(998),
  authoredBody: z.string().max(50_000).optional(),
  tone: emailToneSchema.optional(),
  instruction: z.string().trim().min(1).max(1_000).optional(),
  attachments: emailAttachmentRefsSchema.optional(),
}).superRefine((input, context) => {
  if (input.generationMode === "generate" && !input.tone) context.addIssue({ code: "custom", path: ["tone"], message: "tone is required in generate mode" });
  if (input.generationMode === "preserve" && input.tone !== undefined) context.addIssue({ code: "custom", path: ["tone"], message: "tone is not allowed in preserve mode" });
  if (input.generationMode === "preserve" && input.authoredBody === undefined) context.addIssue({ code: "custom", path: ["authoredBody"], message: "authoredBody is required in preserve mode" });
  const seen = new Map<string, "to" | "cc" | "bcc">();
  for (const field of ["to", "cc", "bcc"] as const) for (const [index, address] of (input[field] ?? []).entries()) {
    const normalized = address.trim().toLocaleLowerCase("en-US");
    const previous = seen.get(normalized);
    if (previous) context.addIssue({ code: "custom", path: [field, index], message: previous === field ? `Duplicate ${field.toUpperCase()} recipient` : `Recipient is already present in ${previous.toUpperCase()}` });
    else seen.set(normalized, field);
  }
});
export const emailAssignDraftInputSchema = z.strictObject({ draftKey: keySchema, connectorKey: keySchema });
export type EmailReplyDraftInput = z.infer<typeof emailReplyDraftInputSchema>;
export type EmailComposeDraftInput = z.input<typeof emailComposeDraftInputSchema>;

export const emailProviderSchema = z.literal("gmail");

export const emailConnectorSchema = z.strictObject({
  key: keySchema, connectorKey: keySchema, provider: emailProviderSchema, email: z.string().email(), name: z.string().min(1), description: z.string().optional(), coverUrl: z.string().url().optional(), isFavorite: z.boolean(),
  status: z.enum(["active", "error", "revoked"]), syncEnabled: z.boolean(), initialSyncCompleted: z.boolean().default(false), syncStatus: z.enum(["idle", "syncing", "error"]), lastSyncedAt: dateSchema.optional(), syncError: z.string().optional(),
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
  key: keySchema, subject: z.string().min(1), summary: z.string().min(1), intent: z.string().min(1), action: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]), state: z.enum(["needs_action", "waiting", "informational", "filtered", "done"]), lastMessageAt: dateSchema,
  snippet: z.string().optional(), category: z.enum(["primary", "updates", "promotions", "social", "forums", "other"]).optional(), unread: z.boolean(), starred: z.boolean().optional(), labels: z.array(z.string()).optional(),
  latestFrom: z.string().email().optional(), inInbox: z.boolean().optional(), isFavorite: z.boolean(), isRead: z.boolean(), inboxCategory: emailInboxCategorySchema,
  createdAt: dateSchema, updatedAt: dateSchema,
}).refine((thread) => thread.unread === undefined || thread.unread === !thread.isRead, "Email read fields must agree.");
export const emailMessageSchema = z.strictObject({
  key: keySchema, threadKey: keySchema, from: z.string().email(), fromName: z.string().trim().min(1).max(320).optional(), to: z.array(z.string().email()), cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1), body: z.string().min(1), summary: z.string().min(1), replyTo: z.string().email().optional(), replyDepth: z.number().int().nonnegative().optional(), labels: z.array(z.string()).optional(), attachments: emailAttachmentRefsSchema.optional(), attachmentAvailability: z.enum(["none", "complete", "truncated", "failed"]), unavailableAttachmentCount: z.number().int().min(1).max(10_000).optional(), direction: z.enum(["inbound", "outbound"]), sentAt: dateSchema, hasAttachments: z.boolean(), isRead: z.boolean(), unread: z.boolean(), inboxCategory: emailInboxCategorySchema, createdAt: dateSchema, updatedAt: dateSchema,
}).refine((message) => message.unread === undefined || message.unread === !message.isRead, "Email read fields must agree.");
const emailDraftBaseShape = {
  key: keySchema, tone: emailToneSchema.optional(), instruction: z.string().optional(), attachments: emailAttachmentRefsSchema.optional(), generatedContent: z.string(), finalContent: z.string().optional(), status: z.enum(["generated", "edited", "sending", "sent", "discarded"]), createdAt: dateSchema, updatedAt: dateSchema,
};
const emailNewDraftSchema = z.strictObject({ ...emailDraftBaseShape, variant: z.literal("new"), connectorKey: keySchema.optional(), to: emailAddressListSchema, cc: z.array(z.string().email()).max(50).optional(), bcc: z.array(z.string().email()).max(50).optional(), subject: z.string().max(998) });
const emailReplyDraftSchema = z.strictObject({ ...emailDraftBaseShape, variant: z.literal("reply"), threadKey: keySchema, messageKey: keySchema, replyMode: emailReplyModeSchema, to: z.array(z.string().email()).max(50), cc: z.array(z.string().email()).max(50), emailWritingProfileKey: keySchema.optional() });
export const emailDraftSchema = z.discriminatedUnion("variant", [emailNewDraftSchema, emailReplyDraftSchema]);

const overviewSchema = z.strictObject({
  accounts: z.array(emailConnectorSchema), selectedAccount: emailConnectorSchema.nullable(), threads: z.array(emailThreadSchema), drafts: z.array(emailDraftSchema),
  tones: z.array(emailToneRecordSchema).default([]),
  unassignedDrafts: z.array(emailDraftSchema).default([]),
  counts: z.strictObject({ all: z.number().int(), important: z.number().int(), urgent: z.number().int(), needsAction: z.number().int(), filtered: z.number().int(), unread: z.number().int(), favorite: z.number().int(), trash: z.number().int() }),
  nextCursor: z.string().min(1).nullable(),
});
const threadDetailSchema = z.strictObject({ thread: emailThreadSchema, messages: z.array(emailMessageSchema.extend({ bodyTruncated: z.boolean() }).strict()), nextCursor: z.string().min(1).nullable(), truncated: z.boolean() });
export const emailTranslationVersionSchema = z.strictObject({
  key: keySchema, documentKey: keySchema, version: z.number().int().positive(), type: z.enum(["enhancement", "translation"]).optional(), language: z.string().optional(), label: z.string().optional(), content: z.string(), createdAt: dateSchema,
});
export const emailSummaryStyleSchema = z.enum(["brief", "detailed", "executive", "bullet-points", "technical"]);
export const emailSummarySchema = z.strictObject({
  key: keySchema, documentKey: keySchema, version: z.number().int().positive(), summary: z.string(), topic: z.string().optional(), style: emailSummaryStyleSchema, language: z.string().optional(), sourceTitle: z.string(), sourceDocumentUpdatedAt: dateSchema, createdAt: dateSchema,
});
export const emailSimilarResultSchema = emailMessageSchema.extend({ similarity: z.number().min(-1).max(1) }).strict();
const emailSimilarResponseSchema = z.strictObject({ messageKey: keySchema, items: z.array(emailSimilarResultSchema) });
const emailTranslationResponseSchema = z.strictObject({ messageKey: keySchema, language: z.string(), version: emailTranslationVersionSchema });
const emailTranslationListResponseSchema = z.strictObject({ messageKey: keySchema, versions: z.array(emailTranslationVersionSchema) });
const emailSummaryResponseSchema = z.strictObject({ messageKey: keySchema, text: z.string(), summary: emailSummarySchema });
const emailSummaryListResponseSchema = z.strictObject({ messageKey: keySchema, summaries: z.array(emailSummarySchema) });
const emailInboxSearchResponseSchema = z.strictObject({ inboxes: z.array(emailConnectorSchema.extend({ score: z.number().min(-1).max(1) }).strict()) });
const emailToneSearchResponseSchema = z.strictObject({ tones: z.array(emailToneRecordSchema.extend({ score: z.number().min(-1).max(1) }).strict()) });
const emailAssistantResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.strictObject({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.strictObject({ type: z.literal("note"), content: z.string(), message: z.string().min(1), sources: z.array(z.strictObject({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.strictObject({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
const generatedRecordKeysSchema = z.array(keySchema).min(1).max(50).refine((keys) => new Set(keys).size === keys.length, "Generated record keys must be distinct.");
export const emailTranslationDeleteInputSchema = z.strictObject({ messageKey: keySchema, translationKeys: generatedRecordKeysSchema });
export const emailSummaryDeleteInputSchema = z.strictObject({ messageKey: keySchema, summaryKeys: generatedRecordKeysSchema });
export const emailGeneratedDeleteResultSchema = z.strictObject({ messageKey: keySchema, deletedKeys: z.array(keySchema).max(50) });
export type EmailOverview = z.infer<typeof overviewSchema>;
export type EmailThread = z.infer<typeof emailThreadSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type EmailTranslationVersion = z.infer<typeof emailTranslationVersionSchema>;
export type EmailSummaryStyle = z.infer<typeof emailSummaryStyleSchema>;
export type EmailSummary = z.infer<typeof emailSummarySchema>;
export type EmailSimilarResult = z.infer<typeof emailSimilarResultSchema>;
export type EmailAssistantResponse = z.infer<typeof emailAssistantResponseSchema>;
export const emailBulkThreadItemSchema = z.discriminatedUnion("status", [
  z.strictObject({ threadKey: keySchema, status: z.literal("succeeded"), thread: emailThreadSchema }),
  z.strictObject({ threadKey: keySchema, status: z.literal("deleted"), error: z.string() }),
  z.strictObject({ threadKey: keySchema, status: z.enum(["failed", "repairPending"]), error: z.string().min(1) }),
]);
export const emailBulkThreadReportSchema = z.strictObject({ requested: z.number().int().nonnegative(), succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), repairPending: z.number().int().nonnegative(), items: z.array(emailBulkThreadItemSchema) }).refine((value) => value.requested === value.items.length && value.succeeded + value.failed + value.repairPending === value.requested, "Email mutation result counts must match its items.");
export type EmailBulkThreadReport = z.infer<typeof emailBulkThreadReportSchema>;

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
type EmailRequestMethod = "post" | "patch" | "delete";
async function request<T>(method: EmailRequestMethod, path: string, body: Record<string, unknown>, schema: z.ZodType<T>, idempotencyKey?: string) {
  return requestForContext(getEmailContext(), method, path, body, schema, undefined, idempotencyKey);
}
async function requestForContext<T>(context: EmailContext, method: EmailRequestMethod, path: string, body: Record<string, unknown>, schema: z.ZodType<T>, timeout?: number, idempotencyKey?: string, signal?: AbortSignal) {
  try {
    const data = { ...contextSchema.parse(context), ...body };
    const currentConnectorTransport = path === "/email/overview" || path === "/email/connect/exchange" || path === "/email/inboxes";
    const config = {
      ...(timeout ? { timeout } : {}),
      ...(idempotencyKey || currentConnectorTransport ? { headers: {
        ...(idempotencyKey ? { "Idempotency-Key": z.string().trim().min(1).max(200).parse(idempotencyKey) } : {}),
        ...(currentConnectorTransport ? { "X-Vorinthex-Email-Transport": "2" } : {}),
      } } : {}),
      ...(signal ? { signal } : {}),
    };
    const response = method === "delete" ? await apiClient.delete(path, { ...config, data }) : await apiClient[method](path, data, config);
    return unwrap(response.data, schema);
  } catch (error) { throw responseError(error); }
}

export type EmailOverviewInput = z.input<typeof emailOverviewInputSchema>;
export function fetchEmailOverview(input: EmailOverviewInput = {}) { return request("post", "/email/overview", emailOverviewInputSchema.parse(input), overviewSchema); }
export function fetchEmailOverviewForContext(context: EmailContext, input: EmailOverviewInput = {}) { return requestForContext(context, "post", "/email/overview", emailOverviewInputSchema.parse(input), overviewSchema); }
export async function searchEmailInboxesForContext(_context: EmailContext, query: string, recordHistory = true, signal?: AbortSignal) {
  const input = emailSemanticSearchInputSchema.parse({ query, recordHistory });
  const output = await searchApp({ ...input, collectionSlugs: ["inboxes"] }, signal);
  return emailInboxSearchResponseSchema.parse({ inboxes: appSearchResults(output, "inboxes", emailConnectorSchema.extend({ score: z.number().min(-1).max(1) }).strict()) });
}
export async function searchEmailTonesForContext(_context: EmailContext, query: string, recordHistory = true, signal?: AbortSignal) {
  const input = emailSemanticSearchInputSchema.parse({ query, recordHistory });
  const output = await searchApp({ ...input, collectionSlugs: ["email-tones"] }, signal);
  return emailToneSearchResponseSchema.parse({ tones: appSearchResults(output, "email-tones", emailToneRecordSchema.extend({ score: z.number().min(-1).max(1) }).strict()) });
}
export async function searchEmailMessagesForContext(_context: EmailContext, connectorKey: string, query: EmailOverviewQuery, recordHistory = true, signal?: AbortSignal) {
  const output = await searchApp({
    query: query.search,
    collectionSlugs: ["email-messages"],
    recordHistory,
    limit: 50,
    filters: { connectorKey, readState: query.readState, emailFacets: [...query.facets] },
  }, signal);
  return appSearchResults(output, "email-messages", emailThreadSchema.extend({ score: z.number() }).strict()).map(({ score: _score, ...thread }) => thread);
}
export async function searchEmailDraftsForContext(_context: EmailContext, connectorKey: string, query: string, recordHistory = true, signal?: AbortSignal) {
  const input = emailSemanticSearchInputSchema.parse({ query, recordHistory, limit: 50 });
  const output = await searchApp({ ...input, collectionSlugs: ["email-drafts"], filters: { connectorKey } }, signal);
  return appSearchResults(output, "email-drafts", z.object({ score: z.number() }).passthrough()).map(({ score: _score, ...draft }) => emailDraftSchema.parse(draft));
}
export async function askEmailAssistantForContext(context: EmailContext, message: string, requestKey: string) {
  try {
    const response = await apiClient.post("/assistant/respond", {
      ...contextSchema.parse(context),
      input: {
        surface: "signal-workspace",
        requestKey: z.string().trim().min(1).max(180).parse(requestKey),
        message: z.string().trim().min(1).max(8_000).parse(message),
        currentNote: { title: "", content: "" },
      },
    }, { timeout: 4 * 60_000 });
    return unwrap(response.data, emailAssistantResponseSchema);
  } catch (error) { throw responseError(error); }
}
export function fetchEmailThread(threadKey: string, cursor?: string) { return request("post", `/email/threads/${keySchema.parse(threadKey)}`, cursor ? { cursor: z.string().min(1).max(2_000).parse(cursor) } : {}, threadDetailSchema); }
export function fetchEmailThreadForContext(context: EmailContext, threadKey: string, cursor?: string) { return requestForContext(context, "post", `/email/threads/${keySchema.parse(threadKey)}`, cursor ? { cursor: z.string().min(1).max(2_000).parse(cursor) } : {}, threadDetailSchema); }
export function setEmailThreadFavorite(threadKey: string, isFavorite: boolean) { return request("post", `/email/threads/${keySchema.parse(threadKey)}/favorite`, { isFavorite }, emailThreadSchema); }
export function setEmailThreadFavoriteForContext(context: EmailContext, threadKey: string, isFavorite: boolean, idempotencyKey?: string) { return requestForContext(context, "post", `/email/threads/${keySchema.parse(threadKey)}/favorite`, { isFavorite }, emailThreadSchema, undefined, idempotencyKey); }
const emailBulkKeysSchema = z.array(keySchema).min(1).max(50).refine((keys) => new Set(keys).size === keys.length, "Thread keys must be distinct.");
export function setEmailThreadsFavoriteForContext(context: EmailContext, threadKeys: string[], isFavorite: boolean, idempotencyKey?: string) { return requestForContext(context, "post", "/email/threads/favorite", { threadKeys: emailBulkKeysSchema.parse(threadKeys), isFavorite }, emailBulkThreadReportSchema, undefined, idempotencyKey); }
export function setEmailThreadsReadStateForContext(context: EmailContext, threadKeys: string[], isRead: boolean, idempotencyKey?: string) { return requestForContext(context, "post", "/email/threads/read-state", { threadKeys: emailBulkKeysSchema.parse(threadKeys), isRead }, emailBulkThreadReportSchema, undefined, idempotencyKey); }
export function trashEmailThreadsForContext(context: EmailContext, threadKeys: string[], idempotencyKey?: string) { return requestForContext(context, "post", "/email/threads/trash", { threadKeys: emailBulkKeysSchema.parse(threadKeys) }, emailBulkThreadReportSchema, undefined, idempotencyKey); }
export function clearEmailTrashForContext(context: EmailContext, connectorKey: string, idempotencyKey?: string) { return requestForContext(context, "post", "/email/trash/clear", { connectorKey: keySchema.parse(connectorKey) }, z.strictObject({ connectorKey: keySchema, providerMessagesDeleted: z.number().int().nonnegative(), threadsDeleted: z.number().int().nonnegative(), documentsDeleted: z.number().int().nonnegative() }), undefined, idempotencyKey); }
export function trashEmailThreadForContext(context: EmailContext, threadKey: string, idempotencyKey?: string) { return requestForContext(context, "post", `/email/threads/${keySchema.parse(threadKey)}/trash`, {}, emailThreadSchema, undefined, idempotencyKey); }
export function findSimilarEmailMessagesForContext(context: EmailContext, messageKey: string, input: { limit?: number } = {}) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/similar`, z.strictObject({ limit: z.number().int().min(1).max(10).optional() }).parse(input), emailSimilarResponseSchema, 120_000); }
export function translateEmailMessageForContext(context: EmailContext, messageKey: string, input: { targetLanguage: string; sourceLanguage?: string }, idempotencyKey?: string) { return requestForContext(context, "post", "/app/translate", { input: { messageKey: keySchema.parse(messageKey), ...z.strictObject({ targetLanguage: z.string().trim().min(2).max(100), sourceLanguage: z.string().trim().min(2).max(100).optional() }).parse(input) } }, emailTranslationResponseSchema, 4 * 60_000, idempotencyKey); }
export function enhanceAppTextForContext(context: EmailContext, text: string) { return requestForContext(context, "post", "/app/enhance", { input: { text: z.string().trim().min(1).max(50_000).parse(text) } }, z.strictObject({ text: z.string().trim().min(1) }), 4 * 60_000); }
export function translateAppTextForContext(context: EmailContext, text: string, targetLanguage: string) { return requestForContext(context, "post", "/app/translate", { input: { text: z.string().trim().min(1).max(50_000).parse(text), targetLanguage: z.string().trim().min(2).max(100).parse(targetLanguage) } }, z.strictObject({ text: z.string().trim().min(1) }), 4 * 60_000); }
export function listEmailMessageTranslationsForContext(context: EmailContext, messageKey: string) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/translations/list`, {}, emailTranslationListResponseSchema); }
export function deleteEmailMessageTranslationsForContext(context: EmailContext, input: z.input<typeof emailTranslationDeleteInputSchema>, idempotencyKey: string) {
  const { messageKey, translationKeys } = emailTranslationDeleteInputSchema.parse(input);
  return requestForContext(context, "delete", `/email/messages/${messageKey}/translations`, { translationKeys }, emailGeneratedDeleteResultSchema, undefined, idempotencyKey);
}
export function summarizeEmailMessageForContext(context: EmailContext, messageKey: string, input: { topic?: string; style?: EmailSummaryStyle; language?: string } = {}, idempotencyKey?: string) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/summaries`, z.strictObject({ topic: z.string().trim().min(1).max(500).optional(), style: emailSummaryStyleSchema.optional(), language: z.string().trim().min(1).max(100).optional() }).parse(input), emailSummaryResponseSchema, 4 * 60_000, idempotencyKey); }
export function listEmailMessageSummariesForContext(context: EmailContext, messageKey: string) { return requestForContext(context, "post", `/email/messages/${keySchema.parse(messageKey)}/summaries/list`, {}, emailSummaryListResponseSchema); }
export function deleteEmailMessageSummariesForContext(context: EmailContext, input: z.input<typeof emailSummaryDeleteInputSchema>, idempotencyKey: string) {
  const { messageKey, summaryKeys } = emailSummaryDeleteInputSchema.parse(input);
  return requestForContext(context, "delete", `/email/messages/${messageKey}/summaries`, { summaryKeys }, emailGeneratedDeleteResultSchema, undefined, idempotencyKey);
}
export function createEmailDraft(input: EmailReplyDraftInput) { return requestForContext(getEmailContext(), "post", "/email/drafts", emailReplyDraftInputSchema.parse(input), emailDraftSchema, 4 * 60_000); }
export function createEmailDraftForContext(context: EmailContext, input: EmailReplyDraftInput, idempotencyKey?: string) { return requestForContext(context, "post", "/email/drafts", emailReplyDraftInputSchema.parse(input), emailDraftSchema, 4 * 60_000, idempotencyKey); }
export function composeEmailDraft(input: EmailComposeDraftInput) { return request("post", "/email/drafts/compose", emailComposeDraftInputSchema.parse(input), emailDraftSchema); }
export function composeEmailDraftForContext(context: EmailContext, input: EmailComposeDraftInput, idempotencyKey?: string, signal?: AbortSignal) { return requestForContext(context, "post", "/email/drafts/compose", emailComposeDraftInputSchema.parse(input), emailDraftSchema, undefined, idempotencyKey, signal); }
export function assignEmailDraft(draftKey: string, connectorKey: string) {
  return assignEmailDraftForContext(getEmailContext(), draftKey, connectorKey);
}
export function assignEmailDraftForContext(context: EmailContext, draftKey: string, connectorKey: string, idempotencyKey?: string) {
  const input = emailAssignDraftInputSchema.parse({ draftKey, connectorKey });
  return requestForContext(context, "post", `/email/drafts/${input.draftKey}/assign`, { connectorKey: input.connectorKey }, emailDraftSchema, undefined, idempotencyKey);
}
function draftUpdateInput(input: string | EmailDraftUpdateInput) { return emailDraftUpdateInputSchema.parse(typeof input === "string" ? { finalContent: input } : input); }
export function updateEmailDraft(draftKey: string, input: string | EmailDraftUpdateInput) { return request("patch", `/email/drafts/${keySchema.parse(draftKey)}`, draftUpdateInput(input), emailDraftSchema); }
export function updateEmailDraftForContext(context: EmailContext, draftKey: string, input: string | EmailDraftUpdateInput, idempotencyKey?: string) { return requestForContext(context, "patch", `/email/drafts/${keySchema.parse(draftKey)}`, draftUpdateInput(input), emailDraftSchema, undefined, idempotencyKey); }
export function deleteEmailDraftForContext(context: EmailContext, draftKey: string, idempotencyKey?: string) { return requestForContext(context, "delete", `/email/drafts/${keySchema.parse(draftKey)}`, {}, z.strictObject({ deletedKey: keySchema }), undefined, idempotencyKey); }
export function sendEmailDraft(draftKey: string) { return request("post", `/email/drafts/${keySchema.parse(draftKey)}/send`, {}, z.object({ sent: z.literal(true), providerMessageId: z.string().min(1), draftKey: keySchema.optional(), threadKey: keySchema.optional() })); }
const emailSendResultSchema = z.strictObject({ sent: z.literal(true), providerMessageId: z.string().min(1).optional(), draftKey: keySchema.optional(), threadKey: keySchema.optional(), messageKey: keySchema.optional() }).transform(({ providerMessageId: _providerMessageId, ...result }) => result);
export function sendEmailDraftForContext(context: EmailContext, draftKey: string, idempotencyKey?: string, replyMode?: EmailReplyMode) { return requestForContext(context, "post", `/email/drafts/${keySchema.parse(draftKey)}/send`, replyMode ? { replyMode: emailReplyModeSchema.parse(replyMode) } : {}, emailSendResultSchema, undefined, idempotencyKey); }
export function fetchEmailTones() { return request("post", "/email/tones/list", {}, z.array(emailToneRecordSchema)); }
export function fetchEmailTonesForContext(context: EmailContext) { return requestForContext(context, "post", "/email/tones/list", {}, z.array(emailToneRecordSchema)); }
export function createEmailTone(input: z.input<typeof emailToneCreateInputSchema>) { return request("post", "/email/tones", emailToneCreateInputSchema.parse(input), emailToneRecordSchema); }
export function createEmailToneForContext(context: EmailContext, input: z.input<typeof emailToneCreateInputSchema>, idempotencyKey?: string) { return requestForContext(context, "post", "/email/tones", emailToneCreateInputSchema.parse(input), emailToneRecordSchema, undefined, idempotencyKey); }
export function updateEmailTone(input: z.input<typeof emailToneUpdateInputSchema>) {
  const { toneKey, ...body } = emailToneUpdateInputSchema.parse(input);
  return request("patch", `/email/tones/${encodeURIComponent(toneKey)}`, body, emailToneRecordSchema);
}
export function updateEmailToneForContext(context: EmailContext, input: z.input<typeof emailToneUpdateInputSchema>, idempotencyKey?: string) {
  const { toneKey, ...body } = emailToneUpdateInputSchema.parse(input);
  return requestForContext(context, "patch", `/email/tones/${encodeURIComponent(toneKey)}`, body, emailToneRecordSchema, undefined, idempotencyKey);
}
export function deleteEmailToneForContext(context: EmailContext, toneKey: string, idempotencyKey?: string) { return requestForContext(context, "delete", `/email/tones/${keySchema.parse(toneKey)}`, {}, z.strictObject({ deletedKey: keySchema }), undefined, idempotencyKey); }
export function fetchEmailReplyContextsForContext(context: EmailContext) { return requestForContext(context, "post", "/email/reply-context/list", {}, z.array(emailReplyContextSchema)); }
export function createEmailReplyContextForContext(context: EmailContext, input: z.input<typeof emailReplyContextCreateInputSchema>, idempotencyKey?: string) {
  return requestForContext(context, "post", "/email/reply-context", emailReplyContextCreateInputSchema.parse(input), emailReplyContextSchema, undefined, idempotencyKey);
}
export function updateEmailReplyContextForContext(context: EmailContext, input: z.input<typeof emailReplyContextUpdateInputSchema>, idempotencyKey?: string) {
  const { noteKey, ...body } = emailReplyContextUpdateInputSchema.parse(input);
  return requestForContext(context, "patch", `/email/reply-context/${encodeURIComponent(noteKey)}`, body, emailReplyContextSchema, undefined, idempotencyKey);
}
export async function deleteEmailReplyContextsForContext(context: EmailContext, noteKeys: string[], idempotencyKey?: string) {
  const input = emailReplyContextDeleteInputSchema.parse({ noteKeys });
  const result = await requestForContext(context, "post", "/email/reply-context/delete", input, emailReplyContextDeleteResultSchema, undefined, idempotencyKey);
  const requested = new Set(input.noteKeys);
  return { deletedNoteKeys: [...new Set(result.deletedKeys.filter((key) => requested.has(key)))] };
}
export function updateEmailInbox(input: z.input<typeof emailInboxUpdateInputSchema>) { return request("patch", "/email/inboxes", emailInboxUpdateInputSchema.parse(input), emailConnectorSchema); }
export function updateEmailInboxForContext(context: EmailContext, input: z.input<typeof emailInboxUpdateInputSchema>, idempotencyKey?: string) { return requestForContext(context, "patch", "/email/inboxes", emailInboxUpdateInputSchema.parse(input), emailConnectorSchema, undefined, idempotencyKey); }
export function disconnectEmail(connectorKey: string) { return disconnectEmailForContext(getEmailContext(), connectorKey); }
export function disconnectEmailForContext(context: EmailContext, connectorKey: string) { return requestForContext(context, "post", "/email/disconnect", { connectorKey: keySchema.parse(connectorKey) }, z.strictObject({ disconnected: z.literal(true) })); }
const connectionExchanges = new Map<string, Promise<EmailConnector>>();
export function exchangeEmailConnection(code: string) {
  const existing = connectionExchanges.get(code);
  if (existing) return existing;
  const operation = request("post", "/email/connect/exchange", { code }, emailConnectorSchema).catch((error: unknown) => { connectionExchanges.delete(code); throw error; });
  connectionExchanges.set(code, operation);
  return operation;
}

export async function launchEmailConnection(connection: z.input<typeof emailConnectionMetadataSchema>) {
  const input = emailConnectionMetadataSchema.parse(connection);
  const start = await request("post", "/email/connect", { provider: "gmail", returnUri: EMAIL_RETURN_URI, ...input }, z.strictObject({ authorizationUrl: z.string().url() }));
  const result = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, EMAIL_RETURN_URI);
  if (result.type !== "success") return null;
  const params = Linking.parse(result.url).queryParams ?? {};
  const error = typeof params.email_connection_error === "string" ? params.email_connection_error : null;
  const code = typeof params.email_connection_code === "string" ? params.email_connection_code : null;
  if (error) throw new Error("Email connection was not completed.");
  if (!code) throw new Error("The email provider returned an incomplete connection response.");
  return exchangeEmailConnection(code);
}
