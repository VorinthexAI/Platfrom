import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, JetBrains_Mono } from "next/font/google";
import { JsonLd } from "@/components/site/JsonLd";
import { buildRobotsMetadata } from "@/lib/metadata";
import { buildGlobalGraph } from "@/lib/structured-data";
import { BLOCK_INDEXING, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
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
  ...buildRobotsMetadata(BLOCK_INDEXING),
};

export const viewport: Viewport = {
  themeColor: "#020304",
  colorScheme: "dark",
};

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
        <JsonLd data={buildGlobalGraph()} />
        {children}
      </body>
    </html>
  );
}
