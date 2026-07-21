import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import type { SeoMeta } from "./products";

/**
 * Scene-facing view over the registry's Core capabilities. This file owns
 * NO content — edit the registry, not this file.
 */

export type CapabilityIcon =
  | "archive"
  | "gallery"
  | "signal"
  | "compass"
  | "ascend"
  | "chorus"
  | "cadence"
  | "momentum"
  | "prism";

export interface CapabilityAsteroidData {
  key: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  answer: string;
  useCases: string[];
  icon: CapabilityIcon;
  parentProduct: "core";
  orbitRadius: number;
  orbitSpeed: number;
  orbitInclination: number;
  initialAngle: number;
  scale: number;
  route: string;
  focusQuery: string;
  entity: GalaxyEntity;
  seo: SeoMeta;
}

function toAsteroidData(entity: GalaxyEntity): CapabilityAsteroidData {
  return {
    key: entity.slug,
    slug: entity.slug,
    name: entity.name,
    tagline: entity.tagline ?? "",
    description: entity.shortDescription,
    answer: entity.aeo?.summary ?? entity.shortDescription,
    useCases: entity.content?.bullets ?? [],
    icon: (entity.logo.iconKey ?? "archive") as CapabilityIcon,
    parentProduct: "core",
    orbitRadius: entity.visual.orbitRadius ?? 2,
    orbitSpeed: entity.visual.orbitSpeed ?? 0.2,
    orbitInclination: entity.visual.orbitInclination ?? 0,
    initialAngle: entity.visual.initialAngle ?? 0,
    scale: entity.visual.size ?? 0.3,
    route: entity.routes.path,
    focusQuery: `/?focus=core&capability=${entity.slug}`,
    entity,
    seo: {
      title: entity.seo.title,
      description: entity.seo.description,
      canonicalPath: entity.routes.canonical ?? entity.routes.path,
    },
  };
}

export const coreCapabilities: CapabilityAsteroidData[] = Object.values(
  VORINTHEX_GALAXY_REGISTRY.capabilities,
).map(toAsteroidData);

export function getCapability(
  slug: string,
): CapabilityAsteroidData | undefined {
  return coreCapabilities.find((c) => c.slug === slug);
}
