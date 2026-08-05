export const dynamic = "force-static";

export function GET() {
  return new Response(`# Vorinthex AI

> Vorinthex Core is one private personal AI for the context that matters to you.

## Vorinthex Core

Core is a mobile app for iOS and Android. It remembers, understands, and connects knowledge, memories, communication, discovery, and personal growth.

## Core Capabilities

- Archive captures, organizes, searches, and connects knowledge.
- Gallery organizes visual memory and understands its context.
- Signal filters communication noise and keeps important conversations connected.
- Compass maps knowledge, places, memories, and plans.
- Ascend supports goals, habits, clarity, and personal growth.

Core is designed around one intelligence, privacy by design, and personal context.

## Links

- [Download Core](https://vorinthex.com)
- [Privacy](https://vorinthex.com/privacy)
- [Terms](https://vorinthex.com/terms)
- [Contact](https://vorinthex.com/contact)
`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
