import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: `${SITE_TAGLINE}. Core is your personal AI Brain.`,
    start_url: "/",
    display: "standalone",
    background_color: "#020304",
    theme_color: "#020304",
    icons: [
      {
        src: "/logos/logo-symbol.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
