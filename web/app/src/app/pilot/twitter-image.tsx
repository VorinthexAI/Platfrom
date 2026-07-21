import { getEntityBySlug } from "@/lib/galaxy/registry-helpers";
import { OG_CONTENT_TYPE, OG_SIZE, entityOgAlt, renderEntityOg } from "@/lib/og-card";

const entity = getEntityBySlug("pilot")!;
export const alt = entityOgAlt(entity);
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export default function Image() { return renderEntityOg(entity); }
