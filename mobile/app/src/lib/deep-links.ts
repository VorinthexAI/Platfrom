import * as Linking from "expo-linking";
import type { Href } from "expo-router";

export const MANAGED_INBOX_DEEP_LINK_HREF = "/capability/signal";

const DEEP_LINK_ROUTES = Object.freeze(["/capability/signal"]);

function pathFromUrl(url: string) {
  const parsed = Linking.parse(url);
  const path = parsed.path?.trim() ?? "";
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

function queryFromUrl(url: string) {
  const params = Linking.parse(url).queryParams ?? {};
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim()) query.set(key, value);
  }
  return query.toString();
}

export function hrefFromDeepLinkUrl(url: string): Href | undefined {
  const path = pathFromUrl(url);
  if (!DEEP_LINK_ROUTES.includes(path)) return undefined;
  const query = queryFromUrl(url);
  return (query ? `${path}?${query}` : path) as Href;
}
