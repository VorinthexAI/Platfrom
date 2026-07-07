import { VORINTHEX_GALAXY_REGISTRY } from "./registry";
import type {
  DeepLinkInput,
  GalaxyEntity,
  RenderState,
} from "./registry-types";

/**
 * Resolution layer over the singleton registry. Components and routes go
 * through these helpers — never through hardcoded slug checks.
 */

const allEntities: GalaxyEntity[] = [
  VORINTHEX_GALAXY_REGISTRY.nexus,
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.products),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators),
];

const byId = new Map(allEntities.map((e) => [e.id, e]));
const byPath = new Map(allEntities.map((e) => [e.routes.path, e]));

const bySubdomain = new Map<string, GalaxyEntity>();
for (const entity of allEntities) {
  for (const subdomain of entity.routes.subdomains ?? []) {
    bySubdomain.set(subdomain.toLowerCase(), entity);
  }
}

export function getAllEntities(): GalaxyEntity[] {
  return allEntities;
}

export function getEntityById(id: string): GalaxyEntity | undefined {
  return byId.get(id);
}

/**
 * Slug lookup. Bare slugs ("archive") search all entities; dotted slugs
 * ("core.archive", "command.atlas") scope to the parent product.
 */
export function getEntityBySlug(slug: string): GalaxyEntity | undefined {
  const normalized = slug.trim().toLowerCase();
  if (normalized.includes(".")) {
    const [parentSlug, childSlug] = normalized.split(".");
    const parent = getProductBySlug(parentSlug);
    if (!parent) return undefined;
    if (!childSlug) return parent;
    return getChildren(parent.id).find((c) => c.slug === childSlug);
  }
  if (normalized === "" || normalized === "nexus") {
    return VORINTHEX_GALAXY_REGISTRY.nexus;
  }
  return allEntities.find((e) => e.slug === normalized);
}

export function getEntityByPath(path: string): GalaxyEntity | undefined {
  const normalized =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return byPath.get(normalized || "/");
}

export function getEntityBySubdomain(
  hostname: string,
): GalaxyEntity | undefined {
  return bySubdomain.get(hostname.toLowerCase().split(":")[0]);
}

export function getProductBySlug(slug: string): GalaxyEntity | undefined {
  return Object.values(VORINTHEX_GALAXY_REGISTRY.products).find(
    (p) => p.slug === slug,
  );
}

export function getChildren(parentId: string): GalaxyEntity[] {
  const parent = byId.get(parentId);
  if (!parent?.children) return [];
  return parent.children
    .map((childId) => byId.get(childId))
    .filter((c): c is GalaxyEntity => Boolean(c));
}

export function getCapabilitiesForCore(): GalaxyEntity[] {
  return getChildren("product.core");
}

export function getOrchestratorsForCommand(): GalaxyEntity[] {
  return getChildren("product.command");
}

export function getStudioChildren(): GalaxyEntity[] {
  return getChildren("product.studio");
}

export function getLaunchChildren(): GalaxyEntity[] {
  return getChildren("product.launch");
}

export function getLiveEntities(): GalaxyEntity[] {
  return allEntities.filter((e) => e.isLive && e.visibility === "live");
}

export function getTeaserEntities(): GalaxyEntity[] {
  return allEntities.filter((e) => e.visibility === "teaser");
}

export function getIndexableEntities(): GalaxyEntity[] {
  return allEntities.filter(
    (e) => e.seo.indexable && e.visibility !== "hidden",
  );
}

/**
 * V4 render-state derivation — the single place where visibility flags
 * become a rendering decision.
 */
export function getEntityRenderState(entity: GalaxyEntity): RenderState {
  if (entity.visibility === "hidden") return "hidden";
  if (entity.isLive && entity.visibility === "live") return "active";
  if (entity.visibility === "locked") return "locked";
  if (entity.visibility === "teaser") return "teaser";
  return "dormant";
}

export function getStatusPrefix(entity: GalaxyEntity): string | null {
  switch (getEntityRenderState(entity)) {
    case "dormant":
    case "teaser":
      return entity.statusLabel ?? "Coming Soon";
    case "locked":
      return "Locked";
    default:
      return null;
  }
}

/**
 * Main deep-link resolver used at page load. Accepts a pathname, optional
 * search params (`?focus=`, `?capability=`, `?target=core.archive`), and an
 * optional hostname for campaign subdomains. Falls back to the Nexus.
 */
export function getDeepLinkTarget(input: DeepLinkInput): GalaxyEntity {
  const { pathname, searchParams, hostname } = input;

  if (hostname) {
    const bySub = getEntityBySubdomain(hostname);
    if (bySub) return bySub;
  }

  const byPathname = getEntityByPath(pathname);
  if (byPathname && byPathname.id !== "nexus.star") return byPathname;

  if (searchParams) {
    const target = searchParams.get("target");
    if (target) {
      const byTarget = getEntityBySlug(target);
      if (byTarget) return byTarget;
    }
    const focus = searchParams.get("focus");
    if (focus) {
      const child = searchParams.get("capability") ?? searchParams.get("child");
      const resolved = getEntityBySlug(child ? `${focus}.${child}` : focus);
      if (resolved) return resolved;
    }
  }

  return VORINTHEX_GALAXY_REGISTRY.nexus;
}

export function getEntityBreadcrumbs(entityId: string): GalaxyEntity[] {
  const crumbs: GalaxyEntity[] = [];
  let current = byId.get(entityId);
  while (current) {
    crumbs.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return crumbs;
}

/** The product an entity belongs to (itself if it is a product). */
export function getOwningProduct(
  entity: GalaxyEntity,
): GalaxyEntity | undefined {
  if (entity.type === "product") return entity;
  if (!entity.parentId) return undefined;
  const parent = byId.get(entity.parentId);
  return parent?.type === "product" ? parent : undefined;
}

/** Command hierarchy depth (Atlas/Sentinel roots = 0). */
export function getOrchestratorDepth(entity: GalaxyEntity): number {
  let depth = 0;
  let current = entity;
  while (current.reportsTo) {
    const parent = byId.get(current.reportsTo);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}
