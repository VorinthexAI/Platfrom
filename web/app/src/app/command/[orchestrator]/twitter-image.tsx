import { getEntityBySlug } from "@/lib/galaxy/registry-helpers";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderBrandedOg,
  renderEntityOg,
} from "@/lib/og-card";

/** Twitter card per Command orchestrator — standalone (Next cannot wire
 * re-exported image exports for dynamic segments). */
export const alt = `${SITE_NAME} — Command orchestrator`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ orchestrator: string }>;
}) {
  const { orchestrator } = await params;
  const entity = getEntityBySlug(`command.${orchestrator}`);
  if (!entity) {
    return renderBrandedOg({
      eyebrow: SITE_NAME,
      title: SITE_NAME,
      subtitle: SITE_TAGLINE,
    });
  }
  return renderEntityOg(entity);
}
