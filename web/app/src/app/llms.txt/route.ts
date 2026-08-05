export const dynamic = "force-static";

export function GET() {
  return new Response(`# Vorinthex AI

> Vorinthex Core is your private personal AI, available for iOS and Android.

## Core

- [Vorinthex Core](https://vorinthex.com): Connect knowledge, memories, communication, discovery, and growth in one personal AI.
- [Core Pricing](https://vorinthex.com/pricing): Core is free. Optional monthly capabilities start at $9.99.

## Company

- [About](https://vorinthex.com/about): Vorinthex AI is an AI-native software company focused on personal intelligence.
- [Privacy](https://vorinthex.com/privacy): Privacy and data controls.
- [Contact](https://vorinthex.com/contact): Contact Vorinthex AI.
`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
