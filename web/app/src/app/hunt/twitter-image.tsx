import { OG_CONTENT_TYPE, OG_SIZE, renderBrandedOg } from "@/lib/og-card";

export const alt =
  "The Hunt: the great collectors of the Vorinthex galaxy, ranked live by Intelligence Fragments — Vorinthex AI";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderBrandedOg({
    title: "The Hunt",
    subtitle:
      "The great collectors of the Vorinthex galaxy, ranked live by Intelligence Fragments.",
    accent: "chrome",
    badge: null,
  });
}
