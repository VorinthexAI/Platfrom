import type { CapabilityAsteroidData } from "@/data/capabilities";
import type { ProductPlanetData } from "@/data/products";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { capabilityIcons, LockIcon } from "@/components/ui/icons";
import { OpenModalButton } from "./OpenModalButton";

/**
 * Server-rendered detail strips for slug routes (/core/archive, /studio, …).
 * They guarantee the deep-linked content exists as immediate SSR HTML even
 * before — or without — the galaxy hydrating.
 */
export function CapabilityDetail({
  capability,
}: {
  capability: CapabilityAsteroidData;
}) {
  const Icon = capabilityIcons[capability.icon];
  return (
    <section
      aria-labelledby={`detail-${capability.key}`}
      className="mx-auto max-w-6xl px-5 pt-24 sm:px-8"
    >
      <div className="panel rounded-[2.5rem] px-6 py-14 sm:px-14">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 text-silver-100">
            <Icon width={18} height={18} />
          </span>
          <div>
            <h2
              id={`detail-${capability.key}`}
              className="font-display text-2xl tracking-[0.18em] text-silver-50 uppercase"
            >
              {capability.name}
            </h2>
            <p className="mt-1 font-mono text-[0.6rem] tracking-[0.24em] text-silver-500 uppercase">
              {capability.tagline} · A Core Capability
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-silver-300">
          {capability.answer}
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-3" role="list">
          {capability.useCases.map((useCase) => (
            <li
              key={useCase}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 text-[0.8rem] leading-relaxed text-silver-500"
            >
              {useCase}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <OpenModalButton
            modal="waitlist"
            variant="primary"
            className="min-h-0 px-7 py-3 text-xs"
          >
            Join Hunt
          </OpenModalButton>
        </div>
      </div>
    </section>
  );
}

/** SSR detail strip for /command/<orchestrator> deep links. */
export function OrchestratorDetail({ entity }: { entity: GalaxyEntity }) {
  return (
    <section
      aria-labelledby={`detail-${entity.slug}`}
      className="mx-auto max-w-6xl px-5 pt-24 sm:px-8"
    >
      <div className="panel rounded-[2.5rem] px-6 py-14 sm:px-14">
        <div className="flex flex-wrap items-center gap-4">
          <h2
            id={`detail-${entity.slug}`}
            className="font-display text-2xl tracking-[0.18em] text-silver-50 uppercase"
          >
            {entity.name}
          </h2>
          <span className="flex items-center gap-1.5 font-mono text-[0.55rem] tracking-[0.24em] text-silver-700 uppercase">
            <LockIcon width={12} height={12} />
            {entity.statusLabel ?? "Coming Soon"}
          </span>
        </div>
        <p className="mt-2 font-mono text-[0.6rem] tracking-[0.24em] text-silver-500 uppercase">
          {entity.fullTitle} · A Command Orchestrator
        </p>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-silver-300">
          {entity.shortDescription}
        </p>
        {entity.content?.bullets ? (
          <ul className="mt-8 grid gap-3 sm:grid-cols-3" role="list">
            {entity.content.bullets.map((bullet) => (
              <li
                key={bullet}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 text-[0.8rem] leading-relaxed text-silver-500"
              >
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-8">
          <OpenModalButton
            modal="waitlist"
            variant="primary"
            className="min-h-0 px-7 py-3 text-xs"
          >
            {entity.content?.primaryCta ?? "Join Hunt"}
          </OpenModalButton>
        </div>
      </div>
    </section>
  );
}

export function ProductDetail({ product }: { product: ProductPlanetData }) {
  return (
    <section
      aria-labelledby={`detail-${product.key}`}
      className="mx-auto max-w-6xl px-5 pt-24 sm:px-8"
    >
      <div className="panel rounded-[2.5rem] px-6 py-14 sm:px-14">
        <div className="flex flex-wrap items-center gap-4">
          <h2
            id={`detail-${product.key}`}
            className="font-display text-2xl tracking-[0.22em] text-silver-50 uppercase"
          >
            {product.name}
          </h2>
          {product.status === "coming-soon" ? (
            <span className="flex items-center gap-1.5 font-mono text-[0.55rem] tracking-[0.24em] text-silver-700 uppercase">
              <LockIcon width={12} height={12} />
              Coming soon
            </span>
          ) : (
            <span className="rounded-full border border-white/15 px-3 py-1 font-mono text-[0.55rem] tracking-[0.24em] text-silver-100 uppercase">
              Available first
            </span>
          )}
        </div>
        <p className="mt-2 font-mono text-[0.6rem] tracking-[0.2em] text-silver-500 uppercase">
          {product.tagline}
        </p>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-silver-300">
          {product.description}
        </p>
        {product.entity.content?.bullets ? (
          <ul className="mt-8 grid gap-3 sm:grid-cols-3" role="list">
            {product.entity.content.bullets.map((bullet) => (
              <li
                key={bullet}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 text-[0.8rem] leading-relaxed text-silver-500"
              >
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-8">
          <OpenModalButton
            modal="waitlist"
            variant="primary"
            className="min-h-0 px-7 py-3 text-xs"
          >
            Join Hunt
          </OpenModalButton>
        </div>
      </div>
    </section>
  );
}
