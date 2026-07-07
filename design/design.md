# Vorinthex — Mini Design System

## Core Direction

Vorinthex ska kännas som **obsidian intelligence**: mörkt, premium, metalliskt, exakt och futuristiskt. Visuellt språk: svart bas, silver/chrome highlights, subtila gradients, skarpa geometrier och mycket luft.

---

## Color Palette

### Base

| Token | Hex | Use |
|---|---:|---|
| `--obsidian-950` | `#030507` | Primary background |
| `--obsidian-900` | `#080B0F` | Section background |
| `--obsidian-850` | `#0D1117` | Cards / panels |
| `--obsidian-800` | `#141922` | Elevated surfaces |
| `--void-black` | `#000000` | Deep contrast / hero |

### Silver / Chrome Accents

| Token | Hex | Use |
|---|---:|---|
| `--silver-50` | `#F5F7F8` | Sharp highlights |
| `--silver-100` | `#DDE2E5` | Primary text on dark |
| `--silver-300` | `#AEB6BC` | Secondary text |
| `--silver-500` | `#7B858C` | Muted UI text |
| `--silver-700` | `#3C434A` | Borders / dividers |
| `--chrome-white` | `#FFFFFF` | Specular shine only |

### Optional Cold Metallic Tint

| Token | Hex | Use |
|---|---:|---|
| `--blue-steel` | `#9FB4C7` | Small hover glow |
| `--gunmetal` | `#1B232C` | Alternative panels |
| `--platinum` | `#C9CED2` | Premium accents |

---

## Gradients

```css
:root {
  --gradient-obsidian: linear-gradient(180deg, #080B0F 0%, #030507 100%);

  --gradient-chrome: linear-gradient(
    135deg,
    #FFFFFF 0%,
    #AEB6BC 18%,
    #3C434A 38%,
    #F5F7F8 55%,
    #7B858C 76%,
    #FFFFFF 100%
  );

  --gradient-silver-soft: linear-gradient(
    135deg,
    rgba(245, 247, 248, 0.95),
    rgba(174, 182, 188, 0.65),
    rgba(60, 67, 74, 0.55)
  );

  --gradient-panel: linear-gradient(
    180deg,
    rgba(20, 25, 34, 0.88),
    rgba(3, 5, 7, 0.96)
  );

  --gradient-border: linear-gradient(
    135deg,
    rgba(255,255,255,0.42),
    rgba(123,133,140,0.18),
    rgba(255,255,255,0.12)
  );
}
```

---

## Typography

### Recommended Fonts

Use elegant, sharp, premium fonts everywhere.

| Role | Font | Why |
|---|---|---|
| Display / Hero | `Cinzel`, `Cormorant Garamond`, `Canela` | Luxurious, mythic, executive |
| UI / Product | `Inter`, `Satoshi`, `Geist` | Clean, modern, readable |
| Technical / Data | `JetBrains Mono`, `IBM Plex Mono` | Precise, intelligence-system feel |

### Font Stack

```css
:root {
  --font-display: "Cinzel", "Cormorant Garamond", serif;
  --font-ui: "Inter", "Satoshi", "Geist", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "IBM Plex Mono", monospace;
}
```

### Type Style

```css
.hero-title {
  font-family: var(--font-display);
  font-size: clamp(3rem, 8vw, 8rem);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  line-height: 0.9;
}

.section-title {
  font-family: var(--font-display);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.body-text {
  font-family: var(--font-ui);
  color: var(--silver-300);
  line-height: 1.65;
}

.micro-label {
  font-family: var(--font-mono);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--silver-500);
}
```

---

## Logo / Icon Treatment

- Use **logo only** when representing each intelligence.
- No title, no name, no role text inside the icon.
- Icons should sit on obsidian-black backgrounds.
- Use chrome/silver gradients with strong highlights and deep inner shadows.
- Keep symbols centered, symmetrical and highly polished.
- Prefer circular containment, thin rings, shields, orbital marks and blade-like geometry.

---

## UI Surfaces

```css
.card {
  background: var(--gradient-panel);
  border: 1px solid rgba(221, 226, 229, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 24px 80px rgba(0,0,0,0.55);
  border-radius: 24px;
}

.chrome-border {
  position: relative;
  border: 1px solid transparent;
  background:
    linear-gradient(#080B0F, #080B0F) padding-box,
    var(--gradient-border) border-box;
}
```

---

## Buttons

```css
.button-primary {
  background: var(--gradient-chrome);
  color: #030507;
  font-family: var(--font-ui);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 999px;
  box-shadow: 0 0 34px rgba(221, 226, 229, 0.22);
}

.button-secondary {
  background: rgba(255,255,255,0.03);
  color: var(--silver-100);
  border: 1px solid rgba(221, 226, 229, 0.18);
  border-radius: 999px;
}
```

---

## Visual Effects

```css
.metal-glow {
  filter: drop-shadow(0 0 18px rgba(221, 226, 229, 0.22));
}

.obsidian-noise {
  background-image:
    radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 34%),
    linear-gradient(180deg, #080B0F, #030507);
}

.divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(221,226,229,0.32),
    transparent
  );
}
```

---

## Brand Rules

1. **Black first.** Everything starts from obsidian black.
2. **Silver is premium, not decorative.** Use it for focus, icons, borders and key CTAs.
3. **No bright colors by default.** Any tint should feel cold, metallic and controlled.
4. **High contrast, low clutter.** Fewer elements, stronger presence.
5. **Mythic + technical.** The system should feel like ancient authority fused with advanced intelligence.
