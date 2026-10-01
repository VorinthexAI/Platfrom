import * as Linking from "expo-linking";
import type { Href } from "expo-router";
import { z } from "zod";

export const HOME_HREF = "/home" as Href;

const DEEP_LINK_ROUTES = Object.freeze(["/home", "/file"]);

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
  if (path === "/file") {
    const params = new URLSearchParams(query);
    if (!z.string().cuid().safeParse(params.get("fileKey")).success) return undefined;
    if (params.has("scopeKey") && !z.string().cuid().safeParse(params.get("scopeKey")).success) return undefined;
  }
  return (query ? `${path}?${query}` : path) as Href;
}
