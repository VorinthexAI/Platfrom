import { CORE_CAPABILITIES } from "@/lib/core";
import styles from "./CorePage.module.css";

export function CoreAppsJourney() {
  return (
    <div className={styles.capabilityJourney}>
      {CORE_CAPABILITIES.map((capability) => (
        <section
          className={styles.journeyStep}
          data-core-app-step
          id={capability.id}
          key={capability.name}
        >
          <div className={styles.panelAnchor}>
            <article className={styles.capabilityPanel}>
              <div className={styles.capabilityDetails}>
                <p className={styles.capabilityLabel}>Core app</p>
                <h3>{capability.name}</h3>
                <p className={styles.capabilityPromise}>{capability.promise}</p>
                <div className={styles.capabilityParagraphs}>
                  {capability.details.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </section>
      ))}
    </div>
  );
}
