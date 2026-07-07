import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export function normalizeEmailInput(email: string) {
  return emailSchema.parse(email);
}

export function parseApiError(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }
  return fallback;
}
