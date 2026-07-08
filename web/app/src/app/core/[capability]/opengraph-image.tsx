import { getEntityBySlug } from "@/lib/galaxy/registry-helpers";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderBrandedOg,
  renderEntityOg,
} from "@/lib/og-card";

/**
 * One unique OG card per Core capability. The parent [capability] route's
 * generateStaticParams enumerates the slugs, so Next renders one image per
 * capability from this default export. Per-slug og:image:alt is supplied by
 * the page's generateMetadata (buildMetadataFromEntity); this file is the art.
 */
export const alt = `${SITE_NAME} — Core capability`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ capability: string }>;
}) {
  const { capability } = await params;
  const entity = getEntityBySlug(`core.${capability}`);
  if (!entity) {
    return renderBrandedOg({
      eyebrow: SITE_NAME,
      title: SITE_NAME,
      subtitle: SITE_TAGLINE,
    });
  }
  return renderEntityOg(entity);
}
