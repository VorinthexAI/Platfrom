import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import {
  getCapabilitiesForCore,
  getOrchestratorsForCommand,
} from "@/lib/galaxy/registry-helpers";

/**
 * Server-rendered definition blocks for answer engines and LLM crawlers,
 * generated from the registry. Visually hidden (the visible experience is
 * spatial), but always present in the SSR HTML.
 */
export function AeoSections() {
  const nexusQa = VORINTHEX_GALAXY_REGISTRY.nexus.aeo?.questions ?? [];
  const coreQa = VORINTHEX_GALAXY_REGISTRY.products.core.aeo?.questions ?? [];
  const capabilities = getCapabilitiesForCore();
  const orchestrators = getOrchestratorsForCommand();
  const products = Object.values(VORINTHEX_GALAXY_REGISTRY.products);

  return (
    <div>
      {[...nexusQa, ...coreQa].map((qa) => (
        <section key={qa.question} aria-label={qa.question}>
          <h2>{qa.question}</h2>
          <p>{qa.answer}</p>
        </section>
      ))}

      <section aria-label="Vorinthex AI products">
        <h2>Vorinthex AI Products</h2>
        {products.map((product) => (
          <article key={product.id}>
            <h3>{product.name}</h3>
            <p>{product.aeo?.summary ?? product.shortDescription}</p>
          </article>
        ))}
      </section>

      <section aria-label="Core capabilities">
        <h2>Core Capabilities</h2>
        {capabilities.map((capability) => (
          <article key={capability.id}>
            <h3>{capability.name}</h3>
            <p>{capability.aeo?.summary ?? capability.shortDescription}</p>
          </article>
        ))}
      </section>

      <section aria-label="Command orchestrators">
        <h2>Command Orchestrators</h2>
        {orchestrators.map((orchestrator) => (
          <article key={orchestrator.id}>
            <h3>
              {orchestrator.name} — {orchestrator.fullTitle}
            </h3>
            <p>{orchestrator.aeo?.summary ?? orchestrator.shortDescription}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
