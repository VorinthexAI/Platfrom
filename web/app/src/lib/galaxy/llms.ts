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
 *
 * Format follows the llms.txt convention (llmstxt.org): an H1 with the
 * site name, a blockquote summary, short context paragraphs, then H2
 * sections of markdown links with one-line descriptions. Everything an
 * AI assistant needs to describe or recommend Vorinthex accurately —
 * products, capabilities, orchestrators, pricing, and status — in one
 * fetch, with llms-full.txt as the deep reference.
 */

function priceLine(entity: { price?: { amount: number } }): string {
  return entity.price ? ` Priced at $${entity.price.amount}/month.` : "";
}

function statusWord(entity: { isLive: boolean; statusLabel?: string }): string {
  return entity.isLive ? "Live" : (entity.statusLabel ?? "Coming soon");
}

export function buildLlmsTxt(): string {
  const brand = VORINTHEX_GALAXY_REGISTRY.brand;
  const nexus = VORINTHEX_GALAXY_REGISTRY.nexus;
  const products = Object.values(VORINTHEX_GALAXY_REGISTRY.products);
  const capabilities = getCapabilitiesForCore();
  const orchestrators = getOrchestratorsForCommand();
  const plans = VORINTHEX_GALAXY_REGISTRY.commandPlans;
  const paidPlans = plans.filter((plan) => plan.priceUsd !== null);
  const priceFloor = Math.min(...paidPlans.map((plan) => plan.priceUsd ?? Infinity));
  const priceCeiling = Math.max(...paidPlans.map((plan) => plan.priceUsd ?? 0));

  return `# ${brand.name}

> ${nexus.aeo?.summary ?? brand.tagline}

${brand.name}, "${brand.tagline}", is a premium AI ecosystem. ${nexus.content?.subheadline ?? ""} The first product to launch is Core, a personal AI Brain that learns, remembers, and evolves with each user, expanded through paid Capabilities. Command (an AI orchestrator suite), Studio (a unified AI workspace), and Launch (an AI agent deployment platform) follow it.

The site is a 3D galaxy: each product is a world orbiting the Nexus star, and visitors collect Intelligence Fragments while exploring in the hunt. Fragments feed the Nexus and place collectors on the hunt's leaderboard; the higher a collector stands at launch, the greater their prizes, offers, and early access. Access before launch is by waitlist.

## Products

${products
  .map(
    (p) =>
      `- [${p.name}](${absoluteUrl(p.routes.path)}): ${p.tagline}. ${p.aeo?.summary ?? p.shortDescription} Status: ${statusWord(p)}.`,
  )
  .join("\n")}

## Core Capabilities

Paid add-ons that expand a user's personal AI Brain inside Core.

${capabilities
  .map(
    (c) =>
      `- [${c.name}](${absoluteUrl(c.routes.path)}): ${c.tagline}. ${c.aeo?.summary ?? c.shortDescription}${priceLine(c)}`,
  )
  .join("\n")}

## Command Orchestrators

Autonomous AI executives inside Command, each with a company scope.

${orchestrators
  .map((o) => `- [${o.name}](${absoluteUrl(o.routes.path)}): ${o.role}, ${o.fullTitle}. ${o.shortDescription}`)
  .join("\n")}

## Pricing

- Core Capabilities are individual monthly subscriptions ($${Math.min(...capabilities.map((c) => c.price?.amount ?? Infinity))} to $${Math.max(...capabilities.map((c) => c.price?.amount ?? 0))} per month).
- Command runs on coin based plans from ${paidPlans[0]?.name ?? "Starter"} ($${priceFloor}/month) to ${paidPlans.at(-1)?.name ?? "Sovereign"} ($${priceCeiling.toLocaleString("en-US")}/month), plus custom enterprise terms.

## Optional

- [About](${absoluteUrl("/about")}): Vorinthex is an AI-native software company building the operating system for AI-powered work.
- [The Hunt](${absoluteUrl("/hunt")}): the live leaderboard of collectors ranked by Intelligence Fragments.
- [llms-full.txt](${absoluteUrl("/llms-full.txt")}): the complete entity reference with per-page URLs and statuses.
- [Sitemap](${absoluteUrl("/sitemap.xml")}): every indexable page.
- [Terms](${absoluteUrl("/terms")}) and [Privacy](${absoluteUrl("/privacy")}).

## Brand

Visual style: obsidian black, chrome/silver, premium, precise, futuristic, minimal, and spacious. Canonical domain: ${absoluteUrl("/")}. Product subdomains (core, command, studio, launch, and each capability and orchestrator) all resolve to their canonical page on the main domain.
`;
}

export function buildLlmsFullTxt(): string {
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
        ...(entity.price
          ? [`- Price: $${entity.price.amount}/${entity.price.interval}`]
          : []),
        `- URL: ${absoluteUrl(entity.routes.path)}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  return `${buildLlmsTxt()}
## All Public Entities

${entitySections}
`;
}
