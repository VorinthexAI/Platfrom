import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().min(1);
const dateSchema = z.iso.datetime();
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
const EMAIL_RETURN_URI = "vorinthexcore://capability/signal";

export const emailFilterSchema = z.enum(["all", "important", "urgent", "needs_action", "filtered", "unread", "favorite"]);
export type EmailFilter = z.infer<typeof emailFilterSchema>;
export const emailToneSchema = z.enum(["concise", "warm", "formal", "direct"]);
export type EmailTone = z.infer<typeof emailToneSchema>;

const accountSchema = z.object({
  key: keySchema, scopeKey: keySchema, provider: z.literal("gmail"), providerAccountId: z.string().min(1), email: z.string().email(), connectorKey: keySchema.optional(),
  syncEnabled: z.boolean(), historyId: z.string().optional(), lastSyncedAt: dateSchema.optional(), syncStatus: z.enum(["idle", "syncing", "error"]).optional(), syncError: z.string().optional(), createdAt: dateSchema, updatedAt: dateSchema,
});
const connectorSchema = z.object({
  key: keySchema, organizationKey: keySchema, scopeKey: keySchema, provider: z.literal("gmail"), providerAccountId: z.string().min(1), email: z.string().email(),
  scopes: z.array(z.string()), createdByMembershipKey: keySchema, status: z.enum(["active", "error", "revoked"]), lastRefreshedAt: dateSchema.optional(), lastError: z.string().optional(), revokedAt: dateSchema.optional(), createdAt: dateSchema, updatedAt: dateSchema,
});
export const emailThreadSchema = z.object({
  key: keySchema, scopeKey: keySchema, accountKey: keySchema, providerThreadId: z.string().min(1), subject: z.string().min(1), summary: z.string().min(1), intent: z.string().min(1), action: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]), state: z.enum(["needs_action", "waiting", "informational", "filtered", "done"]), lastMessageAt: dateSchema,
  snippet: z.string().optional(), category: z.enum(["primary", "updates", "promotions", "social", "forums", "other"]).optional(), unread: z.boolean().optional(), starred: z.boolean().optional(), labels: z.array(z.string()).optional(),
  latestFrom: z.string().email().optional(), inInbox: z.boolean().optional(), isFavorite: z.boolean(),
  createdAt: dateSchema, updatedAt: dateSchema,
});
export const emailMessageSchema = z.object({
  key: keySchema, scopeKey: keySchema, accountKey: keySchema, threadKey: keySchema, providerMessageId: z.string().min(1), from: z.string().email(), to: z.array(z.string().email()), cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1), body: z.string().min(1), summary: z.string().min(1), replyTo: z.string().email().optional(), direction: z.enum(["inbound", "outbound"]), sentAt: dateSchema, hasAttachments: z.boolean(), unread: z.boolean().optional(), createdAt: dateSchema, updatedAt: dateSchema,
});
export const emailDraftSchema = z.object({
  key: keySchema, scopeKey: keySchema, threadKey: keySchema, messageKey: keySchema, emailWritingProfileKey: keySchema.optional(), generatedContent: z.string().min(1), finalContent: z.string().optional(), providerMessageId: z.string().optional(), sendStartedAt: dateSchema.optional(), status: z.enum(["generated", "edited", "sending", "sent", "discarded"]), createdAt: dateSchema, updatedAt: dateSchema,
});

const overviewSchema = z.object({
  account: accountSchema.nullable(), connector: connectorSchema.nullable(), threads: z.array(emailThreadSchema),
  counts: z.object({ all: z.number().int(), important: z.number().int(), urgent: z.number().int(), needsAction: z.number().int(), filtered: z.number().int(), unread: z.number().int(), favorite: z.number().int() }),
});
const threadDetailSchema = z.object({ thread: emailThreadSchema, messages: z.array(emailMessageSchema) });
const assistantResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.strictObject({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.strictObject({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
export type EmailOverview = z.infer<typeof overviewSchema>;
export type EmailThread = z.infer<typeof emailThreadSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;

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
  try {
    const response = await apiClient[method](path, { ...getEmailContext(), ...body });
    return unwrap(response.data, schema);
  } catch (error) { throw responseError(error); }
}

export function fetchEmailOverview(input: { filter?: EmailFilter; search?: string } = {}) { return request("post", "/email/overview", input, overviewSchema); }
export async function syncEmail() {
  try {
    const response = await apiClient.post("/email/sync", getEmailContext(), { timeout: 120_000 });
    return unwrap(response.data, z.object({ synced: z.number().int().nonnegative(), busy: z.boolean().optional(), lastSyncedAt: dateSchema.nullable() }));
  } catch (error) { throw responseError(error); }
}
export function fetchEmailThread(threadKey: string) { return request("post", `/email/threads/${keySchema.parse(threadKey)}`, {}, threadDetailSchema); }
export function setEmailThreadFavorite(threadKey: string, isFavorite: boolean) { return request("post", `/email/threads/${keySchema.parse(threadKey)}/favorite`, { isFavorite }, emailThreadSchema); }
export function createEmailDraft(input: { threadKey: string; tone: EmailTone; instruction?: string }) { return request("post", "/email/drafts", input, emailDraftSchema); }
export function updateEmailDraft(draftKey: string, finalContent: string) { return request("patch", `/email/drafts/${keySchema.parse(draftKey)}`, { finalContent }, emailDraftSchema); }
export function sendEmailDraft(draftKey: string) { return request("post", `/email/drafts/${keySchema.parse(draftKey)}/send`, {}, z.object({ sent: z.literal(true), providerMessageId: z.string().min(1), threadKey: keySchema })); }
export function disconnectEmail() { return request("post", "/email/disconnect", {}, z.object({ disconnected: z.literal(true) })); }
export async function askEmailAssistant(message: string, requestKey: string) {
  const state = useAuthStore.getState();
  const { organizationKey } = getEmailContext();
  const agentKey = typeof state.contentExecution?.agentKey === "string" ? state.contentExecution.agentKey : "";
  if (!agentKey) throw new Error("Your personal assistant is unavailable for this session.");
  try {
    const response = await apiClient.post("/assistant/respond", {
      organizationKey,
      agentKey,
      input: { surface: "signal-workspace", requestKey: z.string().trim().min(1).max(180).parse(requestKey), message: z.string().trim().min(1).max(8_000).parse(message), currentNote: { title: "", content: "" } },
    }, { timeout: 4 * 60_000 });
    return unwrap(response.data, assistantResponseSchema);
  } catch (error) { throw responseError(error); }
}

const connectionExchanges = new Map<string, Promise<void>>();
export function exchangeEmailConnection(code: string) {
  const existing = connectionExchanges.get(code);
  if (existing) return existing;
  const operation = request("post", "/email/connect/exchange", { code }, connectorSchema).then(() => undefined).catch((error: unknown) => { connectionExchanges.delete(code); throw error; });
  connectionExchanges.set(code, operation);
  return operation;
}

export async function launchEmailConnection() {
  const start = await request("post", "/email/connect", { returnUri: EMAIL_RETURN_URI }, z.object({ authorizationUrl: z.string().url() }));
  const result = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, EMAIL_RETURN_URI);
  if (result.type !== "success") return false;
  const params = Linking.parse(result.url).queryParams ?? {};
  const error = typeof params.email_connection_error === "string" ? params.email_connection_error : null;
  const code = typeof params.email_connection_code === "string" ? params.email_connection_code : null;
  if (error) throw new Error("Gmail connection was not completed.");
  if (!code) throw new Error("Google returned an incomplete connection response.");
  await exchangeEmailConnection(code);
  return true;
}
