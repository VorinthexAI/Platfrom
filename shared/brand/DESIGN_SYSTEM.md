# Vorinthex AI — Design System

*Identity & Interface System · v1.0 · June 2026*

A refined system for an unhurried, considered AI platform. Set entirely in serif.
The platform orchestrates autonomous agents — but the identity reads like a high-end
publication, never a SaaS dashboard. **Restraint is the system.**

---

## 1. Principles

1. **One accent, used like a cufflink.** Bronze appears only on primary actions and
   active states — never large surfaces, never body text, never decoration.
2. **Flat throughout.** No gradients, no shadows, no glow. Depth comes from the
   cream / white surface contrast and hairline borders alone.
3. **Whitespace is the material.** Components are spaced apart, not packed together.
   The system should feel unhurried.
4. **Serif everywhere.** Fraunces carries headings, body, buttons, labels, navigation.
   No secondary sans-serif anywhere.
5. **Confident ambiguity.** The name explains nothing on sight, and the identity
   never over-explains itself.

---

## 2. Colour

| Token            | Hex       | Role |
|------------------|-----------|------|
| Page             | `#FAF7F2` | Warm cream base — never pure white |
| Secondary        | `#F0EBE2` | Pills, subtle panel fills |
| Surface          | `#FFFFFF` | Cards — lifts off cream by contrast alone |
| Text (primary)   | `#1C1A17` | Warm near-black — never pure black |
| Text (muted)     | `#6B6358` | Secondary text and labels |
| Accent           | `#8B6F47` | Bronze — primary actions / active states only |
| Accent (light)   | `#C9A876` | Hover and selection only |
| Border / divider | `#E3DCD0` | Barely-there hairlines |

**Usage rules**
- Bronze never fills a large area. If everything is bronze, nothing is.
- `#C9A876` is exclusively a hover / selection tint — never a resting state.
- Borders are 0.5–1px hairlines in `#E3DCD0`. They define edges; shadows do not.

---

## 3. Typography — Fraunces only

Weight and optical size do the work a second typeface usually would.

| Style      | Size  | Weight | Line-height | Notes |
|------------|-------|--------|-------------|-------|
| Display    | 108px | 300    | 0.98        | Masthead / hero only |
| Heading 1  | 52px  | 400    | 1.05        | Page titles |
| Heading 2  | 40px  | 400    | 1.05        | Section titles |
| Heading 3  | 28px  | 500    | 1.1         | Card / block titles |
| Lede       | 22px  | 400 *italic* | 1.45   | Intros, pull quotes |
| Body       | 17px  | 400    | 1.55        | Default reading text |
| Label      | 13px  | 500    | 1.2         | Eyebrows / UI labels — `letter-spacing: 0.18em`, uppercase |

- Letter-spacing tightens slightly on large headings (`-0.015em` to `-0.02em`).
- Eyebrow labels are uppercase with wide tracking; everything else is sentence case.
- Tabular numerals for any figures in tables and stats.

---

## 4. Spacing

An 8-point base with a few half-steps. Tokens: **4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96**.

- Card padding: `20px` minimum, `clamp(24px, 3vw, 44px)` typical.
- Section rhythm: `88–104px` between major sections.
- Default gap between sibling components: `28px`.

---

## 5. Components

### Buttons
- **Primary** — solid bronze fill (`#8B6F47`), cream text, 9px radius, `12px 26px` padding.
  Hover → fill `#C9A876`. Never two primaries competing in one view.
- **Secondary** — transparent fill, `1px` border `#E3DCD0`, muted text.
  Hover → border + text shift to bronze.
- **Tertiary** — text only, bronze, no border.
- **Disabled** — `#F0EBE2` fill, muted text, `opacity 0.7`, `not-allowed`.

### Form elements
- Inputs / selects: cream fill (`#FAF7F2`), hairline border, 9px radius.
  **Focus** → `1px` bronze ring (`box-shadow: 0 0 0 1px #8B6F47`) — no glow.
- Select uses a quiet bronze caret, native chevron suppressed.
- **Toggle** — pill track; bronze when on, `#E3DCD0` when off; white knob.
- **Checkbox** — 6px-radius square; bronze fill + cream check when on.

### Status indicators
A small bronze dot + muted label inside a soft `#F0EBE2` pill. Never a loud,
saturated badge. Idle / paused states soften the dot to `#C9A876`.

### Cards
White surface, `1px` border `#E3DCD0`, 12px radius, generous padding (1.25rem+).
Internal dividers are hairlines, not new borders.

### Data table
Horizontal hairlines only — no vertical rules, no zebra striping. Rows get
`18px` vertical padding so they breathe. Column headers are uppercase
12px labels in muted text. Numerals are tabular and right-aligned.

### Empty state
An invitation, not an apology. A single quiet mark, a calm headline
(*"Nothing running yet"*), one supportive line, and one primary action.

### Iconography
Only when genuinely needed. `1.4px` stroke, rounded caps, geometric forms on a
24-unit grid. No fills, no icon-pack filler. Sparse and hand-considered.

---

## 6. Logo — Layered Planes

The primary symbol is three thin, overlapping planes — orchestration suggested,
never spelled out. Front plane at full weight; receding planes at **60%** and **30%**
opacity to imply depth.

**Variants**
- Bronze on cream — primary lockup
- Bronze on surface — on cards
- Reverse — cream on ink (`#1C1A17`)
- Monochrome — single-colour ink

**Sizing** — holds from `512px` down to a `16px` favicon. At favicon scale the mark
simplifies to two planes to stay legible.

**Lockups** — horizontal (symbol + Fraunces wordmark) and stacked. Clear space on all
sides equals the height of one plane.

**Don'ts** — no gradients, shadows, or glow on the mark; never recolour outside the
palette; never stretch or rotate.

### Provided assets (`/Logo`)
- `logo-symbol-{16,32,64,128,512}.png` — transparent background
- `logo-symbol-cream-{16,32,64,128,512}.png` — cream background, rounded corners, no border
