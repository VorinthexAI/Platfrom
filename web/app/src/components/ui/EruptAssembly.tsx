"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * The biome-entry eruption for DOM content — the screen-space twin of the
 * interior emblem's shard assembly. The WHOLE wrapped card is split into
 * a grid of clipped shards that blast up from below as tumbling debris
 * and fuse back into the finished card, exactly like the logo. A fresh
 * seed re-erupts the assembly on every biome entry.
 *
 * Wrap exactly one card element. While the shards fly, the real card is
 * hidden and stands in as the layout; the moment the last shard lands it
 * wakes up, live and interactive.
 */
export function EruptAssembly({
  seed,
  className,
  children,
}: {
  /** World-gen seed of the visit; a new seed re-erupts the card. */
  seed: number;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const card = root?.firstElementChild as HTMLElement | null | undefined;
    if (!root || !card) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const width = card.offsetWidth;
    const height = card.offsetHeight;
    if (width === 0 || height === 0) return;

    // The shard grid scales with the card: a lone button splits into a
    // few chunks, a full panel into a proper debris field.
    const cols = Math.min(5, Math.max(2, Math.round(width / 110)));
    const rows = Math.min(5, Math.max(2, Math.round(height / 90)));

    // Hide the real card and fly its clones: every shard is a full clone
    // clipped to one grid cell, so together the debris IS the card.
    card.style.visibility = "hidden";
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "1";

    const random = mulberry32(seed ^ 0xca4d);
    const duration = 1000;
    let lastLanding = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const shard = document.createElement("div");
        shard.style.position = "absolute";
        shard.style.inset = "0";
        shard.style.clipPath = `inset(${(row / rows) * 100}% ${(1 - (col + 1) / cols) * 100}% ${(1 - (row + 1) / rows) * 100}% ${(col / cols) * 100}%)`;
        shard.style.willChange = "transform";
        const clone = card.cloneNode(true) as HTMLElement;
        clone.style.visibility = "visible";
        clone.style.width = `${width}px`;
        clone.style.height = `${height}px`;
        clone.style.margin = "0";
        shard.appendChild(clone);
        overlay.appendChild(shard);

        // The emblem's launch profile: ballistic chaos from below, pulled
        // into the slot as it rises.
        const scatterX = (random() - 0.5) * 220;
        const scatterY = 130 + random() * 240;
        const rotate = (random() - 0.5) * 56;
        const scale = 0.5 + random() * 0.4;
        const delay = (0.3 + random() * 0.75) * 1000;
        lastLanding = Math.max(lastLanding, delay + duration);
        shard.animate(
          [
            {
              transform: `translate(${scatterX}px, ${scatterY}px) rotate(${rotate}deg) scale(${scale})`,
              opacity: 0,
            },
            { opacity: 1, offset: 0.35 },
            {
              transform: "translate(0px, 0px) rotate(0deg) scale(1)",
              opacity: 1,
            },
          ],
          {
            delay,
            duration,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            fill: "backwards",
          },
        );
      }
    }
    root.appendChild(overlay);

    // The last shard lands: the debris goes home, the real card wakes.
    const reveal = window.setTimeout(() => {
      card.style.visibility = "";
      overlay.remove();
    }, lastLanding);

    return () => {
      window.clearTimeout(reveal);
      overlay.remove();
      card.style.visibility = "";
    };
  }, [seed]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      {children}
    </div>
  );
}
