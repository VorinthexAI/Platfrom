"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";
import { products } from "@/data/products";
import { trackCtaClick } from "@/lib/analytics";
import { useAudioStore } from "@/lib/audio/audio-store";
import {
  stepIndexForFocus,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";

/**
 * Fixed top bar: brand mark, centered product tabs (with Coming Soon
 * sublabels, like the reference art), and the waitlist actions.
 */
export function SiteNav() {
  const focus = useGalaxyStore((s) => s.focus);
  const setStep = useGalaxyStore((s) => s.setStep);
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const playMission = useAudioStore((s) => s.playMission);

  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <nav
        aria-label="Primary"
        className="mx-auto grid h-20 w-full max-w-7xl grid-cols-[1fr_auto] items-center px-5 sm:px-10 lg:grid-cols-[1fr_auto_1fr]"
      >
        <Link href="/" className="flex items-center gap-3 justify-self-start">
          {/* unoptimized: a 1.3 KB mark gains nothing from /_next/image,
              and the optimizer route can hang (it kept the tab's load
              event, and its spinner, alive forever on the dev server). */}
          <Image
            src="/logos/vorinthex-mark-128.png"
            alt=""
            width={30}
            height={30}
            className="opacity-90"
            priority
            unoptimized
          />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-[0.8rem] font-semibold tracking-[0.3em] text-silver-50">
              VORINTHEX AI
            </span>
            <span className="mt-1 font-mono text-[0.5rem] tracking-[0.38em] text-silver-500 uppercase">
              Nexus of Intelligence
            </span>
          </span>
        </Link>

        {/* product tabs — desktop only */}
        <div className="hidden items-start gap-9 lg:flex">
          {products.map((product) => {
            const active = focus === product.key;
            return (
              <button
                key={product.key}
                type="button"
                onClick={() => {
                  trackCtaClick("nav_product", {
                    product_key: product.key,
                    product_name: product.name,
                    route: product.route,
                  });
                  setStep(stepIndexForFocus(product.key));
                  syncEntityUrl(product.route);
                }}
                aria-current={active ? "true" : undefined}
                className="group flex flex-col items-center gap-1.5 pt-1"
              >
                <span
                  className={`font-display text-[0.68rem] tracking-[0.3em] uppercase transition-colors ${
                    active
                      ? "text-silver-50"
                      : "text-silver-500 group-hover:text-silver-300"
                  }`}
                >
                  {product.name}
                </span>
                {product.status === "coming-soon" ? (
                  <span className="font-mono text-[0.48rem] tracking-[0.2em] text-silver-700 uppercase">
                    Coming Soon
                  </span>
                ) : (
                  <span
                    className={`block h-1 w-1 rounded-full transition-all ${
                      active
                        ? "bg-silver-100 shadow-[0_0_8px_rgba(221,226,229,0.7)]"
                        : "bg-transparent"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 justify-self-end sm:gap-6">
          <button
            type="button"
            onClick={() => {
              trackCtaClick("signin_open", { placement: "nav_desktop" });
              enterCave("signin");
            }}
            className="hidden text-xs tracking-[0.06em] text-silver-500 transition-colors hover:text-silver-100 md:block"
          >
            Already on waitlist?{" "}
            <span className="underline underline-offset-4">Sign in</span>
          </button>
          <button
            type="button"
            onClick={() => {
              trackCtaClick("signin_open", { placement: "nav_mobile" });
              enterCave("signin");
            }}
            className="text-xs tracking-[0.06em] text-silver-500 transition-colors hover:text-silver-100 md:hidden"
          >
            Sign in
          </button>
          <Button
            variant="primary"
            onClick={() => {
              trackCtaClick("waitlist_open", { placement: "nav" });
              enterCave("join");
            }}
            className="min-h-0 px-5 py-2.5 text-[0.65rem]"
          >
            Join Waitlist
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              trackCtaClick("mission_audio", { placement: "nav" });
              playMission();
            }}
            icon={<SpeakerIcon animated />}
            className="min-h-0 px-4 py-2.5 text-[0.65rem] uppercase"
          >
            <span className="hidden sm:inline">Hear the Mission</span>
            <span className="sr-only sm:hidden">Hear the Mission</span>
          </Button>
        </div>
      </nav>
    </header>
  );
}
