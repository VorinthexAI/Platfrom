"use client";

import { products } from "@/data/products";

/**
 * CSS/SVG stand-in for the galaxy when WebGL is unavailable: the Nexus sun
 * and four orbits rendered as slow-spinning rings. All real content lives
 * in the surrounding HTML, so nothing is lost.
 */
export function StaticHeroFallback() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      {/* ember core */}
      <div
        className="absolute h-40 w-40 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 42% 38%, rgba(176,106,56,0.5), rgba(138,75,36,0.22) 45%, rgba(3,5,7,0.9) 75%)",
          boxShadow: "0 0 120px 30px rgba(138,75,36,0.18)",
          animation: "ember-pulse 8s ease-in-out infinite",
        }}
      />
      {products.map((product, index) => {
        const size = 220 + index * 170;
        const duration = 90 + index * 50;
        return (
          <div
            key={product.key}
            className="absolute rounded-full border border-white/[0.08]"
            style={{
              width: size,
              height: size,
              animation: `orbit-spin ${duration}s linear infinite`,
            }}
          >
            <span
              className="absolute top-1/2 -left-1.5 block h-3 w-3 -translate-y-1/2 rounded-full"
              style={{
                background:
                  product.status === "active"
                    ? "linear-gradient(135deg, #f5f7f8, #7b858c)"
                    : "#1b232c",
                border: "1px solid rgba(221,226,229,0.25)",
              }}
            />
          </div>
        );
      })}
      {/* faint stars */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 12% 22%, rgba(221,226,229,0.8), transparent), radial-gradient(1px 1px at 78% 14%, rgba(221,226,229,0.6), transparent), radial-gradient(1.5px 1.5px at 62% 68%, rgba(221,226,229,0.5), transparent), radial-gradient(1px 1px at 30% 80%, rgba(221,226,229,0.7), transparent), radial-gradient(1px 1px at 88% 52%, rgba(221,226,229,0.5), transparent)",
        }}
      />
    </div>
  );
}
