import { File } from "expo-file-system";
import { z } from "zod";

import { apiClient } from "./api-client";

export const profileNameSchema = z.string().trim().min(1).max(200);
export const avatarUploadSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255).refine((value) => !/[\\/]/.test(value)),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  uri: z.string().min(1),
});
export const ticketSchema = z.strictObject({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().trim().min(1),
  message: z.string().trim().min(1).max(8_000),
});
export const feedbackVoteSchema = z.enum(["up", "down"]);
export const feedbackItemSchema = z.strictObject({
  key: z.string().min(1),
  message: z.string().min(1).max(8_000),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  viewerVote: feedbackVoteSchema.nullable(),
  createdAt: z.string().datetime(),
});
export const feedbackListSchema = z.strictObject({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});
export const feedbackVoteRequestSchema = z.strictObject({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().trim().min(1),
  ticketKey: z.string().trim().min(1),
  vote: feedbackVoteSchema.nullable(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

type ProfilePatch = { avatarUrl?: string; name?: string };
const mutationQueues = { avatar: Promise.resolve(), name: Promise.resolve() };

function serializeMutation<T>(field: keyof typeof mutationQueues, mutation: () => Promise<T>) {
  const result = mutationQueues[field].then(mutation, mutation);
  mutationQueues[field] = result.then(() => undefined, () => undefined);
  return result;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function responseData(value: unknown) {
  const root = record(value);
  return record(root?.data) ?? root;
}

function profilePatch(value: unknown): ProfilePatch {
  const data = responseData(value);
  const sources = [record(data?.user), record(data?.profile), data];
  const name = sources.map((source) => source?.name).find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate));
  const avatar = sources.flatMap((source) => [source?.avatarUrl, source?.avatar_url]).find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate));
  return { ...(name ? { name } : {}), ...(typeof avatar === "string" && avatar ? { avatarUrl: avatar } : {}) };
}

export function updateProfileName(rawName: string) {
  const name = profileNameSchema.parse(rawName);
  return serializeMutation("name", async () => {
    const response = await apiClient.patch("/auth/me/profile", { name });
    return { name, ...profilePatch(response.data) };
  });
}

export function uploadProfileAvatar(rawFile: z.input<typeof avatarUploadSchema>) {
  const file = avatarUploadSchema.parse(rawFile);
  return serializeMutation("avatar", async () => {
    const reservationResponse = await apiClient.post("/auth/me/profile/avatar/uploads/presign", {
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    });
    const reservation = responseData(reservationResponse.data);
    const uploadKey = z.string().min(1).parse(reservation?.uploadKey);
    const signedUrl = z.string().url().parse(reservation?.url ?? reservation?.uploadUrl);
    const headers = z.record(z.string(), z.string()).optional().parse(reservation?.headers) ?? { "Content-Type": file.mimeType };
    const bytes = await new File(file.uri).arrayBuffer();
    if (bytes.byteLength !== file.sizeBytes) throw new Error("The selected image changed before it could be uploaded.");
    const uploadResponse = await fetch(signedUrl, { method: "PUT", headers, body: bytes });
    if (!uploadResponse.ok) throw new Error(`Profile image upload failed (${uploadResponse.status}).`);
    const completionResponse = await apiClient.post("/auth/me/profile/avatar/uploads/complete", { uploadKey });
    const completed = profilePatch(completionResponse.data);
    return completed.avatarUrl ? completed : { avatarUrl: file.uri };
  });
}

export async function createSupportTicket(rawInput: z.input<typeof ticketSchema>, idempotencyKey: string) {
  const input = ticketSchema.parse(rawInput);
  const key = z.string().trim().min(1).max(200).parse(idempotencyKey);
  await apiClient.post("/tickets", input, { headers: { "Idempotency-Key": key } });
}

export async function createFeedback(rawInput: z.input<typeof ticketSchema>, idempotencyKey: string) {
  const input = ticketSchema.parse(rawInput);
  const key = z.string().trim().min(1).max(200).parse(idempotencyKey);
  const response = await apiClient.post("/feedback", input, { headers: { "Idempotency-Key": key } });
  return feedbackItemSchema.parse(responseData(response.data));
}

export async function listFeedback(rawInput: z.input<typeof feedbackListSchema>) {
  const input = feedbackListSchema.parse(rawInput);
  const response = await apiClient.post("/feedback/list", input);
  const result = z.strictObject({ items: z.array(feedbackItemSchema), nextCursor: z.string().nullable() }).parse(responseData(response.data));
  return { ...result, items: result.items.toReversed() };
}

export async function setFeedbackVote(rawInput: z.input<typeof feedbackVoteRequestSchema>, idempotencyKey: string) {
  const { ticketKey, ...input } = feedbackVoteRequestSchema.parse(rawInput);
  const key = z.string().trim().min(1).max(200).parse(idempotencyKey);
  const response = await apiClient.put(`/feedback/${ticketKey}/vote`, input, { headers: { "Idempotency-Key": key } });
  return feedbackItemSchema.parse(responseData(response.data));
}
