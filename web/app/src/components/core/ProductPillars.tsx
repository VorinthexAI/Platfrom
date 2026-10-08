import { PRODUCT_PILLARS } from "@/lib/core";
import styles from "./CorePage.module.css";

export function ProductPillars() {
  return (
    <div className={styles.pillarGrid}>
      {PRODUCT_PILLARS.map((pillar) => (
        <article className={styles.capabilityPanel} id={pillar.id} key={pillar.id}>
          <div className={styles.capabilityDetails}>
            <p className={styles.capabilityLabel}>Vorinthex AI</p>
            <h3>{pillar.name}</h3>
            <p className={styles.capabilityPromise}>{pillar.promise}</p>
            <div className={styles.capabilityParagraphs}>
              {pillar.details.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
