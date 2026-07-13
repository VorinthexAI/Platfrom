import axios, { type AxiosInstance } from "axios";

/**
 * Typed HTTP client abstraction for the future Core API.
 *
 * INTENTIONALLY UNUSED in this mockup — no screen makes a network request.
 * When the backend exists, TanStack Query queryFns swap their local mock
 * resolvers for these helpers without any screen-level changes.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: "https://api.vorinthex.com",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

export async function getJson<T>(path: string): Promise<T> {
  const response = await apiClient.get<T>(path);
  return response.data;
}

export async function postJson<TBody, TResponse>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response = await apiClient.post<TResponse>(path, body);
  return response.data;
}
