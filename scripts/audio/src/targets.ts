import { CORE_CAPABILITIES } from "../../../web/app/src/lib/core";
import type { AudioCategory } from "./types";

type CoreEntity = {
  shortDescription: string;
  tagline?: string;
  role?: string;
  fullTitle?: string;
  content: { drawerLine: string; bullets?: string[] };
};

export type AudioTarget = {
  slug: string;
  name: string;
  category: AudioCategory;
  entityId: string;
  description: string;
  entity?: CoreEntity;
};

export function listTargets(): AudioTarget[] {
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
        entity: {
          shortDescription: description,
          content: { drawerLine: description },
        },
      };
    }),
  ];
}

export function findTarget(category: AudioCategory, slug: string): AudioTarget | undefined {
  return listTargets().find((target) => target.category === category && target.slug === slug);
}
