import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vorinthex.com";

const privatePaths = [
  "/api/",
  "/auth/totp/",
  "/console/",
  "/login",
  "/login/",
  "/public/auth/magic-link/verify",
  "/public/auth/magic-link/verify/",
  "/public/auth/token",
  "/public/auth/token/",
  "/public/auth/verify",
  "/public/auth/verify/",
  "/public/updates/unsubscribe",
  "/public/updates/unsubscribe/",
  "/public/waitlist/verify",
  "/public/waitlist/verify/",
  "/signin",
  "/signin/",
  "/signup",
  "/signup/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-Web",
          "PerplexityBot",
          "Google-Extended",
          "Applebot",
          "OAI-SearchBot",
        ],
        allow: "/",
        disallow: privatePaths,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
