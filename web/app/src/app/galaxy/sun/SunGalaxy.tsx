"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Inside the star. The member surfs into the sun after MFA: every wall,
 * the floor, and the ceiling glow like the solar interior — layered
 * plasma gradients breathing slowly around a single chrome card carrying
 * the CEO's welcome.
 */
export function SunGalaxy() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const storedName = window.localStorage.getItem("vx_member_name");
      if (storedName?.trim()) {
        setName(storedName.trim());
        return;
      }
      const email = window.localStorage.getItem("vx_member_email");
      if (email) {
        const handle = email.split("@")[0]?.split(".")[0] ?? "";
        if (handle) setName(handle.charAt(0).toUpperCase() + handle.slice(1));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-16">
      {/* The solar chamber: floor, ceiling, and walls are all plasma. */}
      <div aria-hidden className="sun-chamber absolute inset-0">
        <div className="sun-core" />
        <div className="sun-flare sun-flare-a" />
        <div className="sun-flare sun-flare-b" />
        <div className="sun-flare sun-flare-c" />
        <div className="sun-grain" />
        <div className="sun-vignette" />
      </div>

      <section
        className="chrome-border card-depth relative z-10 w-full max-w-md rounded-3xl p-8 text-center sm:p-10"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="micro-label">The Inner Galaxy</p>
        <h1 className="font-display mt-4 text-2xl leading-snug tracking-[0.1em] text-silver-50">
          {name ? `Hi ${name},` : "Hi,"} welcome to the inner galaxy of
          Vorinthex AI.
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-silver-300">
          Looking forward to working together to form this product as the
          next generation AI-native platform — enabling anyone to use AI in
          their day-to-day life.
        </p>
        <p className="mt-6 font-mono text-[0.6rem] tracking-[0.24em] text-silver-500 uppercase">
          — Your CEO, Oscar
        </p>
        <div className="mt-9 border-t border-white/8 pt-7">
          <Link
            href="/"
            className="vui-button vui-button-secondary min-h-0 px-7 py-3 text-xs uppercase"
          >
            Back to the galaxy
          </Link>
        </div>
      </section>

      <style jsx>{`
        .sun-chamber {
          background:
            radial-gradient(
              120% 90% at 50% 110%,
              #7a2d05 0%,
              #4a1503 34%,
              #1c0701 68%,
              #0a0301 100%
            );
        }
        .sun-core {
          position: absolute;
          inset: -20%;
          background: radial-gradient(
            55% 45% at 50% 52%,
            rgba(255, 214, 140, 0.5) 0%,
            rgba(255, 155, 64, 0.32) 30%,
            rgba(214, 92, 22, 0.16) 55%,
            transparent 78%
          );
          animation: sun-breathe 9s ease-in-out infinite;
        }
        .sun-flare {
          position: absolute;
          inset: -35%;
          mix-blend-mode: screen;
          filter: blur(46px);
          opacity: 0.5;
        }
        .sun-flare-a {
          background: radial-gradient(
            42% 34% at 24% 22%,
            rgba(255, 158, 66, 0.42) 0%,
            transparent 70%
          );
          animation: sun-drift-a 17s ease-in-out infinite;
        }
        .sun-flare-b {
          background: radial-gradient(
            38% 30% at 78% 30%,
            rgba(255, 122, 32, 0.36) 0%,
            transparent 70%
          );
          animation: sun-drift-b 23s ease-in-out infinite;
        }
        .sun-flare-c {
          background: radial-gradient(
            50% 36% at 52% 88%,
            rgba(255, 189, 96, 0.4) 0%,
            transparent 72%
          );
          animation: sun-drift-c 14s ease-in-out infinite;
        }
        .sun-grain {
          position: absolute;
          inset: 0;
          opacity: 0.16;
          background-image: radial-gradient(
              rgba(255, 220, 170, 0.5) 0.6px,
              transparent 0.6px
            ),
            radial-gradient(rgba(255, 170, 90, 0.35) 0.5px, transparent 0.5px);
          background-size:
            46px 46px,
            29px 29px;
          background-position:
            0 0,
            13px 19px;
        }
        .sun-vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            85% 75% at 50% 50%,
            transparent 42%,
            rgba(8, 3, 1, 0.55) 82%,
            rgba(4, 1, 0, 0.85) 100%
          );
        }
        @keyframes sun-breathe {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.07);
            opacity: 0.82;
          }
        }
        @keyframes sun-drift-a {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(6%, 4%, 0) scale(1.12);
          }
        }
        @keyframes sun-drift-b {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1.05);
          }
          50% {
            transform: translate3d(-5%, 6%, 0) scale(0.94);
          }
        }
        @keyframes sun-drift-c {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(3%, -5%, 0) scale(1.1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sun-core,
          .sun-flare {
            animation: none;
          }
        }
      `}</style>
    </main>
  );
}
