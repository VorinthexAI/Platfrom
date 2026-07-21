import { VORINTHEX_GALAXY_REGISTRY } from "../../../web/app/src/lib/galaxy/registry";
import type { GalaxyEntity } from "../../../web/app/src/lib/galaxy/registry-types";
import type { AudioCategory } from "./types";

export type AudioTarget = {
  slug: string;
  name: string;
  category: AudioCategory;
  entityId: string;
  description: string;
  entity?: GalaxyEntity;
};

export function listTargets(): AudioTarget[] {
  const brand: AudioTarget = {
    slug: "vorinthex-ai",
    name: "Vorinthex AI",
    category: "master-brand",
    entityId: VORINTHEX_GALAXY_REGISTRY.brand.id,
    description: "Vorinthex AI master brand: The Nexus of Intelligence."
  };
  return [
    brand,
    ...Object.values(VORINTHEX_GALAXY_REGISTRY.products).map((entity) => toTarget(entity, "product")),
    ...Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities).map((entity) => toTarget(entity, "capability")),
    ...Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators).map((entity) => toTarget(entity, "orchestrator"))
  ];
}

export function findTarget(category: AudioCategory, slug: string): AudioTarget | undefined {
  return listTargets().find((target) => target.category === category && target.slug === slug);
}

function toTarget(entity: GalaxyEntity, category: AudioCategory): AudioTarget {
  return {
    slug: entity.slug,
    name: entity.name,
    category,
    entityId: entity.id,
    description: entity.longDescription ?? entity.shortDescription,
    entity
  };
}
