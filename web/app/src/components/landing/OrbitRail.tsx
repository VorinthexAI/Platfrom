"use client";

import { Fragment } from "react";
import { products } from "@/data/products";
import { getChildren, getEntityRenderState } from "@/lib/galaxy/registry-helpers";
import { trackCtaClick } from "@/lib/analytics";
import {
  ORBIT_STEPS,
  stepIndexForFocus,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";

interface ChildStop {
  slug: string;
  name: string;
  stepIndex: number;
  path: string;
}

interface ProductStop {
  key: (typeof products)[number]["key"];
  name: string;
  stepIndex: number;
  path: string;
  children: ChildStop[];
}

const productStops: ProductStop[] = products.map((product) => ({
  key: product.key,
  name: product.name,
  stepIndex: stepIndexForFocus(product.key),
  path: product.route,
  children: getChildren(product.entity.id)
    .filter((child) => getEntityRenderState(child) !== "hidden")
    .map((child) => ({
      slug: child.slug,
      name: child.name,
      stepIndex: stepIndexForFocus(product.key, child.slug),
      path: child.routes.path,
    })),
}));

/**
 * Vertical orbit rail on the right edge. Accordion behavior: the focused
 * product expands its children as smaller sub-dots directly beneath it;
 * moving to another product collapses the previous one, so the rail never
 * grows past one open parent.
 */
export function OrbitRail() {
  const step = useGalaxyStore((s) => s.step);
  const focus = useGalaxyStore((s) => s.focus);
  const mode = useGalaxyStore((s) => s.mode);
  const setStep = useGalaxyStore((s) => s.setStep);

  if (mode === "cave" || mode === "jump" || mode === "intro") return null;

  const go = (stepIndex: number, path: string) => {
    trackCtaClick("orbit_rail", { step_index: stepIndex, route: path });
    setStep(stepIndex);
    syncEntityUrl(path);
  };

  const currentPath = ORBIT_STEPS[step]?.path ?? "/";

  return (
    <nav
      aria-label="Orbits"
      className={`absolute top-1/2 right-4 z-20 -translate-y-1/2 transition-opacity duration-500 sm:right-7 ${
        mode === "belt" ? "pointer-events-none opacity-25" : "opacity-100"
      }`}
    >
      <ul className="relative flex flex-col items-end gap-5">
        <span
          aria-hidden
          className="absolute top-2 right-[5px] bottom-2 w-px bg-white/10"
        />
        <RailDot
          label="Nexus"
          active={step === 0}
          onClick={() => go(0, "/")}
        />
        {productStops.map((product) => {
          const productActive = focus === product.key;
          const expanded = productActive && product.children.length > 0;
          return (
            <Fragment key={product.key}>
              <RailDot
                label={product.name}
                active={productActive && currentPath === product.path}
                emphasized={productActive}
                onClick={() => go(product.stepIndex, product.path)}
              />
              {expanded
                ? product.children.map((child) => (
                    <RailDot
                      key={child.slug}
                      label={child.name}
                      active={currentPath === child.path}
                      small
                      onClick={() => go(child.stepIndex, child.path)}
                    />
                  ))
                : null}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}

function RailDot({
  label,
  active,
  emphasized = false,
  small = false,
  onClick,
}: {
  label: string;
  active: boolean;
  emphasized?: boolean;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <li className={`relative ${small ? "-my-1.5 pr-[2px]" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className="group flex items-center gap-3"
      >
        <span
          className={`hidden font-mono tracking-[0.26em] uppercase transition-colors md:block ${
            small ? "text-[0.48rem]" : "text-[0.55rem]"
          } ${
            active || emphasized
              ? "text-silver-100"
              : "text-silver-700 group-hover:text-silver-300"
          }`}
        >
          {label}
        </span>
        <span
          className={`relative block rounded-full border transition-all ${
            small ? "h-[7px] w-[7px]" : "h-[11px] w-[11px]"
          } ${
            active
              ? "border-silver-100 bg-silver-100 shadow-[0_0_12px_rgba(221,226,229,0.6)]"
              : "border-silver-700 bg-transparent group-hover:border-silver-300"
          }`}
        />
      </button>
    </li>
  );
}
