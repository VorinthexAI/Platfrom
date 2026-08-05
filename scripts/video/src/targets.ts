import { CORE_CAPABILITIES } from "../../../web/app/src/lib/core";
import type { VideoCategory } from "./types";

type CoreEntity = {
  role?: string;
  fullTitle?: string;
  content: { bullets?: string[] };
};

export type VideoTarget = {
  slug: string;
  name: string;
  category: VideoCategory;
  entityId: string;
  description: string;
  entity?: CoreEntity;
};

export function listTargets(): VideoTarget[] {
  return [
    {
      slug: "vorinthex-ai",
      name: "Vorinthex AI",
      category: "master-brand",
      entityId: "brand.vorinthex",
      description: "Vorinthex AI: your personal AI.",
    },
    {
      slug: "core",
      name: "Core",
      category: "product",
      entityId: "product.core",
      description: "One private personal AI that grows with you.",
    },
    ...CORE_CAPABILITIES.map(({ name, description }) => {
      const slug = name.toLowerCase();
      return {
        slug,
        name,
        category: "capability" as const,
        entityId: `capability.${slug}`,
        description,
      };
    }),
  ];
}

export function findTarget(category: VideoCategory, slug: string): VideoTarget | undefined {
  return listTargets().find((target) => target.category === category && target.slug === slug);
}
