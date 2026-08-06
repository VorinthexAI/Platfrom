import Image from "next/image";
import { CORE_CAPABILITIES } from "@/lib/core";
import styles from "./CorePage.module.css";

export function CoreAppsJourney() {
  return (
    <div className={styles.capabilityJourney}>
      {CORE_CAPABILITIES.map((capability, index) => (
        <section
          className={styles.journeyStep}
          data-core-app-step
          id={capability.id}
          key={capability.name}
        >
          <div className={styles.panelAnchor}>
            <article className={styles.capabilityPanel}>
              <span className={styles.capabilityIndex}>0{index + 1}</span>
              <Image
                alt={`${capability.name} icon`}
                height={200}
                src={capability.icon}
                width={200}
              />
              <div className={styles.capabilityDetails}>
                <p className={styles.capabilityLabel}>Core app</p>
                <h3>{capability.name}</h3>
                <p className={styles.capabilityPromise}>{capability.promise}</p>
                <p>{capability.detail}</p>
                <ul>
                  {capability.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className={styles.coreConnection}>
                  <span>Connected intelligence</span>
                  <p>{capability.connection}</p>
                </div>
              </div>
            </article>
          </div>
        </section>
      ))}
    </div>
  );
}
