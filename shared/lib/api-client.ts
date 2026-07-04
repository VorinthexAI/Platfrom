import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  "";
const BACKEND_API_KEY =
  process.env.NEXT_PUBLIC_BACKEND_API_KEY ??
  process.env.EXPO_PUBLIC_BACKEND_API_KEY ??
  process.env.BACKEND_API_KEY;

const apiVersionPath = "/api/v1";

export type ApiClientConfig = AxiosRequestConfig & {
  baseURL?: string;
};

function enforceCookieCredentials(
  config: InternalAxiosRequestConfig,
): InternalAxiosRequestConfig {
  config.withCredentials = true;
  return config;
}

function normalizeApiBaseUrl(baseURL: string | undefined): string | undefined {
  if (!baseURL) {
    return baseURL;
  }

  const normalizedBaseUrl = baseURL.replace(/\/+$/, "");

  if (normalizedBaseUrl.endsWith(apiVersionPath)) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}${apiVersionPath}`;
}

function buildDefaultHeaders() {
  return {
    Accept: "application/json",
    ...(BACKEND_API_KEY ? { "x-vorinthex-api-key": BACKEND_API_KEY } : {}),
  };
}

function buildApiClient(config: ApiClientConfig = {}): AxiosInstance {
  const client = axios.create({
    timeout: 30_000,
    headers: {
      ...buildDefaultHeaders(),
      ...config.headers,
    },
    ...config,
    baseURL: normalizeApiBaseUrl(config.baseURL ?? API_BASE_URL),
    withCredentials: true,
  });

  client.interceptors.request.use(enforceCookieCredentials);

  return client;
}

export const apiClient = buildApiClient();

export function createApiClient(config?: ApiClientConfig): AxiosInstance {
  return buildApiClient(config);
}
