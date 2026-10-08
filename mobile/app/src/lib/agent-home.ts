import type { Href } from "expo-router";

export function agentHomeHref(slug: string): Href {
  return (slug === "core" ? "/home" : `/${slug}`) as Href;
}
