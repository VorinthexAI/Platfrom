import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://orbit.ai",
);

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Orbit",
  title: {
    default: "Orbit",
    template: "%s | Orbit",
  },
  description: "Orbit.",
  authors: [{ name: "Orbit" }],
  creator: "Orbit",
  publisher: "Orbit",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Orbit",
    title: "Orbit",
    description: "Orbit.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Orbit",
    description: "Orbit.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  manifest: "/manifest.webmanifest",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#09090B",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" style={{ colorScheme: "dark" }}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
