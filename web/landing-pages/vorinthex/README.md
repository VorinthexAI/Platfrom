# Vorinthex AI Web

Next.js app scaffolded for Bun, TypeScript, Tailwind CSS, TanStack Query, Zod,
date-fns, and Axios.

Lives at `web/landing-pages/vorinthex` — a sibling of `web/landing-pages/orbit`,
both consuming the same top-level `shared` workspace package.

## Getting Started

Install dependencies:

```bash
bun install
```

Run the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Copy `../../../environments/.env.example` to `../../../environments/.env.dev` and set:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

## Shared Module

Reusable code lives in the top-level `../../../shared` workspace package. It is not a git submodule.

The shared Axios singleton is exported from `@vorinthex/shared/lib`:

```ts
import { apiClient } from "@vorinthex/shared/lib";
```

The client always sets `withCredentials: true`, so browser requests include
cookies for cookie-based API sessions.

## UI Package

The shared UI library lives in `../../../shared/packages/ui` and exports:

```ts
import { Button, HomeIcon } from "@vorinthex/shared/ui";
```

Each component and icon has a folder with web and mobile implementations:

```text
button/button.web.tsx
button/button.mobile.tsx
button/index.ts
```

Web implementations use Radix primitives where accessibility behavior matters.
Mobile implementations use React Native components and `StyleSheet.create`.
