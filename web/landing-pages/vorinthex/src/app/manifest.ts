import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vorinthex AI",
    short_name: "Vorinthex AI",
    description:
      "Mobile apps, built and grown on autopilot.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF7F2",
    theme_color: "#8B6F47",
    icons: [
      {
        src: "/logos/logo-transparent.png",
        sizes: "256x256",
        type: "image/png",
      },
      {
        src: "/logos/logo-transparent.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
