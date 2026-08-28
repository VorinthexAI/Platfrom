import { create } from "axios";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com";
const BACKEND_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY ?? "";

export const publicApiClient = create({
  baseURL: `${API_BASE_URL.replace(/\/$/, "")}/api/v1`,
  timeout: 15_000,
  withCredentials: false,
  headers: {
    "Content-Type": "application/json",
    ...(BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {}),
  },
});

export function publicApiUrl(path: string) {
  return `${API_BASE_URL.replace(/\/$/, "")}/api/v1/${path.replace(/^\//, "")}`;
}

export function publicApiHeaders() {
  return BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {};
}
