import { VORINTHEX_GALAXY_REGISTRY } from "./registry";
import {
  getCapabilitiesForCore,
  getIndexableEntities,
  getOrchestratorsForCommand,
} from "./registry-helpers";
import { absoluteUrl } from "@/lib/site";

/**
 * llms.txt / llms-full.txt content, generated from the registry so answer
 * engines always see the current product map.
 */

export function buildLlmsTxt(): string {
  const products = Object.values(VORINTHEX_GALAXY_REGISTRY.products);
  const capabilities = getCapabilitiesForCore();

  return `# ${VORINTHEX_GALAXY_REGISTRY.brand.name}

${VORINTHEX_GALAXY_REGISTRY.nexus.aeo?.summary ?? ""}

## Products

${products
  .map((p) => `- ${p.name}: ${p.aeo?.llmsText ?? p.shortDescription}`)
  .join("\n")}

## Core Capabilities

${capabilities
  .map((c) => `- ${c.name}: ${c.aeo?.llmsText ?? c.shortDescription}`)
  .join("\n")}

## Primary Page

The primary landing page focuses on Core and invites users to join the waitlist.

## Brand

Visual style: obsidian black, chrome/silver, premium, precise, futuristic, minimal, and spacious.
`;
}

export function buildLlmsFullTxt(): string {
  const orchestrators = getOrchestratorsForCommand();
  const entities = getIndexableEntities();

  const entitySections = entities
    .filter((e) => e.type !== "star")
    .map((entity) => {
      const lines = [
        `### ${entity.name}${entity.role ? ` (${entity.role})` : ""}`,
        "",
        entity.aeo?.summary ?? entity.shortDescription,
        "",
        `- Type: ${entity.type}`,
        `- Status: ${entity.isLive ? "live" : (entity.statusLabel ?? "coming soon")}`,
        `- URL: ${absoluteUrl(entity.routes.path)}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  return `${buildLlmsTxt()}
## Command Orchestrators

${orchestrators
  .map((o) => `- ${o.name} (${o.role}): ${o.shortDescription}`)
  .join("\n")}

## All Public Entities

${entitySections}
`;
}
