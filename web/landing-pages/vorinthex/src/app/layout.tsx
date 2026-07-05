import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://vorinthex.com",
);

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Vorinthex AI",
  title: {
    default: "Vorinthex AI | Mobile apps on autopilot",
    template: "%s | Vorinthex AI",
  },
  description:
    "Mobile apps, built and grown on autopilot. Vorinthex AI builds, markets, and grows apps from one quiet agent system.",
  keywords: [
    "Vorinthex AI",
    "AI agents",
    "AI team",
    "mobile app builder",
    "app marketing",
    "app growth",
    "marketing automation",
    "mobile app analytics",
  ],
  authors: [{ name: "Vorinthex AI" }],
  creator: "Vorinthex AI",
  publisher: "Vorinthex AI",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Vorinthex AI",
    title: "Vorinthex AI | Mobile apps on autopilot",
    description:
      "Mobile apps, built and grown on autopilot. Building, marketing, and growth from one quiet agent system.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Vorinthex AI mobile apps on autopilot",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vorinthex AI | Mobile apps on autopilot",
    description:
      "Mobile apps, built and grown on autopilot. Building, marketing, and growth from one quiet agent system.",
    images: ["/twitter-image"],
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
  category: "technology",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/logos/logo-symbol-64.png", sizes: "64x64", type: "image/png" },
      { url: "/logos/logo-symbol-256.png", sizes: "256x256", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Vorinthex AI",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#FAF7F2",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Vorinthex AI",
    url: siteUrl.toString(),
    logo: new URL("/logos/logo-symbol-512.png", siteUrl).toString(),
    sameAs: [],
  };

  return (
    <html
      lang="en"
      className={`${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
