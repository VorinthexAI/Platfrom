import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, JetBrains_Mono } from "next/font/google";
import {
  coreSoftwareJsonLd,
  faqJsonLd,
  organizationJsonLd,
  webSiteJsonLd,
} from "@/lib/structured-data";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import "./globals.css";

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Vorinthex AI is the Nexus of Intelligence: your personal AI for everything, with infinite memory. Core is your personal AI Brain, built to grow with you through Capabilities.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description:
      "Your personal AI for everything, with infinite memory. Explore the Vorinthex galaxy and grow your own AI Brain.",
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    images: ["/social-cards/vorinthex/opengraph.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description:
      "Your personal AI for everything, with infinite memory. Explore the Vorinthex galaxy and grow your own AI Brain.",
    images: ["/social-cards/vorinthex/twitter.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#020304",
  colorScheme: "dark",
};

const jsonLd = [
  organizationJsonLd,
  webSiteJsonLd,
  coreSoftwareJsonLd,
  faqJsonLd,
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${cinzel.variable} ${geist.variable} ${jetbrains.variable} antialiased`}
      >
        {jsonLd.map((entry, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
          />
        ))}
        {children}
      </body>
    </html>
  );
}
