# Vorinthex Core Mobile Mockup — Coding Agent Prompt

## Mission

Build a high-fidelity React Native mobile mockup for Vorinthex Core.

Treat this phase as design-first and interaction-first.

Do not implement authentication, backend services, databases, payments, or production integrations.

Use local mock data only.

Prioritize visual fidelity, motion quality, and clean maintainable architecture.

## Repository discovery

Inspect the repository before writing implementation code.

Open the root-level `design` folder.

Find the approved mobile mockup image inside the root-level `design` folder.

Use that image as the primary visual source of truth.

Study every visible screen, layout, spacing relationship, icon placement, and implied transition.

Do not loosely reinterpret the approved mockup.

Inspect the shared design system before creating new primitives.

Use the existing design tokens from `shared`.

Use the existing component library from `shared`.

Use the existing icon library from `shared`.

Reuse existing typography, spacing, radii, shadows, borders, surfaces, and motion tokens.

Extend shared primitives instead of creating a duplicate design system.

Inspect `web/app/public` for the real Vorinthex logos.

Use the real brand and product logo assets from `web/app/public`.

Do not redraw official logos.

Do not substitute generic symbols when approved assets exist.

Follow current monorepo conventions for sharing or copying assets into mobile.

## Technical stack

Use React Native.

Use Expo with the bare workflow.

Use TypeScript everywhere.

Use strict TypeScript settings.

Use Zod for runtime validation of the capability registry and mock data.

Use Axios as the future HTTP client abstraction.

Do not make real Axios requests in this mockup.

Use TanStack Query for future-ready server-state structure.

Do not connect TanStack Query to a live endpoint.

Use Zustand for onboarding and local UI state.

Use React Native Reanimated for animations.

Use React Native Gesture Handler for swipe gestures.

Use Expo Router or React Navigation according to existing repository conventions.

Prefer dependencies already installed in the repository.

Use safe-area handling correctly.

Use Expo Image or the repository-standard image component.

## Architecture

Keep screens, components, state, mock data, theme, motion, and assets separated.

Keep screen components thin.

Create a typed capability registry.

Validate the registry with Zod.

Create reusable onboarding card-stack components.

Create a reusable capability screen shell.

Create a reusable chrome icon treatment.

Create a reusable monochrome neural background.

Create a QueryClient provider.

Create a typed Axios client that remains unused.

Avoid unnecessary abstractions.

## Required flow

Launch directly into the splash screen.

Show no login screen.

Show no signup screen.

Show no OAuth flow.

Transition from splash into five-card onboarding.

Transition from onboarding into a `Building Your Brain` screen.

Transition from the building screen into the AI brain home screen.

Allow Archive, Gallery, Signal, Compass, and Ascend to open from the brain.

Allow each capability screen to return to the brain.

Do not add a bottom navigation bar.

## Splash screen

Use a pure obsidian-black background.

Place `VORINTHEX AI` above the central logo.

Use the real Vorinthex logo from `web/app/public`.

Place `The Nexus of Intelligence` below the logo.

Center the composition.

Use generous spacing.

Use only black, white, silver, chrome, platinum, and gunmetal.

Do not use accent colors.

Add a subtle metallic glow.

Animate the logo with a restrained fade and scale reveal.

Optionally animate a soft neutral specular highlight.

Keep the splash visible for roughly two seconds.

## Onboarding content

Create exactly five onboarding cards.

The order is Archive, Gallery, Signal, Compass, and Ascend.

Use the approved Archive chrome icon.

Use the approved Gallery chrome icon.

Use the approved Signal chrome icon.

Use the approved Compass chrome icon.

Use the approved Ascend chrome icon.

Inspect repository assets before creating any fallback.

Preserve transparent backgrounds and aspect ratios.

Render icons sharply at high pixel density.

## Onboarding stack

The active card must face exactly forward.

The active card must not be skewed at rest.

The active card must not be rotated at rest.

The active card must not use strong perspective.

Show two or three cards stacked directly behind it.

Keep all rear cards centered.

Reveal rear cards with small vertical offsets.

Use slight scale reduction for depth.

Use thin borders and shadows to separate the layers.

Do not fan cards sideways.

The stack should feel physical, premium, and controlled.

## Swipe interaction

Swipe left means skip.

Swipe right means enable.

Do not show large X and check buttons.

Do not show Tinder-style floating action buttons.

Use gesture-led interaction.

Show subtle helper text near the bottom.

Use `Swipe left to skip` and `Swipe right to enable`.

Use drag resistance.

Use velocity and distance thresholds.

Use spring physics for snap-back.

Allow only minimal rotation while actively dragging.

Return a cancelled card to a perfectly frontal orientation.

Animate completed cards off-screen.

Animate the next card forward from behind.

Make the next card feel like it pops forward from the stack.

Reflow remaining cards smoothly.

Use subtle haptics when available.

Provide an accessible non-gesture fallback.

Store decisions in Zustand only.

Navigate automatically after the fifth card.

## Onboarding card design

Use a tall rounded rectangle.

Use an obsidian-black panel.

Use a thin neutral chrome border.

Use a subtle inset highlight.

Use a deep soft shadow.

Use no colored border.

Use no colored glow.

Center the icon in the upper section.

Place the uppercase capability name below it.

Use generous letter spacing.

Add a concise two-to-three-line description.

Keep the content centered.

Use generous breathing room.

Use a monochrome progress marker.

## Capability copy direction

Archive should communicate storing, organizing, retrieving, and connecting knowledge.

Gallery should communicate collecting, organizing, searching, and reliving visual memories.

Signal should communicate filtering noise and surfacing important communication.

Compass should communicate mapping places, memories, journeys, and future destinations.

Ascend should communicate growth, goals, habits, learning, and personal development.

Keep all copy simple, concrete, and premium.

## Building Your Brain

Show `Building Your Brain` immediately after onboarding.

Render a monochrome neural brain made from nodes, filaments, and light pulses.

Use only silver, white, platinum, gray, and black.

Do not use colored neural clusters.

Add a minimal progress line or percentage.