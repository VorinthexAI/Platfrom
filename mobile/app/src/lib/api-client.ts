import { create, type AxiosInstance } from "axios";

/** Typed HTTP client shared by authenticated mobile capabilities. */
export const apiClient: AxiosInstance = create({
  baseURL: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com",
  timeout: 15_000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    ...(process.env.EXPO_PUBLIC_BACKEND_API_KEY ? { "X-Vorinthex-API-Key": process.env.EXPO_PUBLIC_BACKEND_API_KEY } : {}),
  },
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
