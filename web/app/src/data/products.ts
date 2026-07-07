import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";

/**
 * Scene-facing view over the galaxy registry. This file owns NO content —
 * it reshapes registry entities into the flat structure the 3D scene and
 * legacy components consume. Edit the registry, not this file.
 */

export type ProductStatus = "active" | "coming-soon";
export type ProductKey = "core" | "command" | "studio" | "launch";

export interface SeoMeta {
  title: string;
  description: string;
  canonicalPath: string;
  ogImage?: string;
  noindex?: boolean;
}

export interface ProductPlanetData {
  key: ProductKey;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: ProductStatus;
  orbitRadius: number;
  orbitSpeed: number;
  initialAngle: number;
  scale: number;
  route: string;
  focusQuery: string;
  hoverLine: string;
  subtitle: string;
  drawerCopy: string;
  entity: GalaxyEntity;
  seo: SeoMeta;
}

function toPlanetData(entity: GalaxyEntity): ProductPlanetData {
  const comingSoon = !entity.isLive;
  return {
    key: entity.slug as ProductKey,
    slug: entity.slug,
    name: entity.name,
    tagline: entity.tagline ?? entity.shortDescription,
    description: entity.shortDescription,
    status: comingSoon ? "coming-soon" : "active",
    orbitRadius: entity.visual.orbitRadius ?? 4,
    orbitSpeed: entity.visual.orbitSpeed ?? 0.05,
    initialAngle: entity.visual.initialAngle ?? 0,
    scale: entity.visual.size ?? 1,
    route: entity.routes.path,
    focusQuery: `/?focus=${entity.slug}`,
    hoverLine: comingSoon
      ? `${entity.label ?? entity.tagline}. ${entity.statusLabel ?? "Coming soon"}.`
      : (entity.label ?? entity.tagline ?? entity.name),
    subtitle: entity.label ?? entity.tagline ?? "",
    drawerCopy: entity.longDescription ?? entity.shortDescription,
    entity,
    seo: {
      title: entity.seo.title,
      description: entity.seo.description,
      canonicalPath: entity.routes.canonical ?? entity.routes.path,
    },
  };
}

export const products: ProductPlanetData[] = Object.values(
  VORINTHEX_GALAXY_REGISTRY.products,
).map(toPlanetData);

export const productByKey = new Map(products.map((p) => [p.key, p]));

export function getProduct(key: string): ProductPlanetData | undefined {
  return products.find((p) => p.slug === key);
}
