import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: `${SITE_TAGLINE}. One private intelligence that grows with you.`,
    start_url: "/",
    display: "standalone",
    background_color: "#020304",
    theme_color: "#020304",
    icons: [
      {
        src: "/logos/vorinthex-mark.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
