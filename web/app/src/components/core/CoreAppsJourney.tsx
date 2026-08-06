"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { CORE_CAPABILITIES } from "@/lib/core";
import styles from "./CorePage.module.css";

export function CoreAppsJourney() {
  const journeyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const journey = journeyRef.current;
    if (!journey) return;

    const steps = Array.from(
      journey.querySelectorAll<HTMLElement>("[data-core-app-step]"),
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const update = () => {
      frame = 0;
      const viewportHeight = window.innerHeight;
      for (const step of steps) {
        const rect = step.getBoundingClientRect();
        const reveal = Math.min(
          1,
          Math.max(0, (viewportHeight * 0.12 - rect.top) / (viewportHeight * 0.32)),
        );
        const fadeIn = Math.min(
          1,
          Math.max(0, (viewportHeight * 0.9 - rect.top) / (viewportHeight * 0.25)),
        );
        const fadeOut = Math.min(
          1,
          Math.max(0, (rect.bottom - viewportHeight * 0.1) / (viewportHeight * 0.25)),
        );
        const opacity = Math.min(fadeIn, fadeOut);

        step.style.setProperty(
          "--cube-turn",
          reducedMotion.matches ? (reveal > 0.5 ? "180deg" : "0deg") : `${reveal * 180}deg`,
        );
        step.style.setProperty("--step-opacity", `${opacity}`);
      }
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  return (
    <div className={styles.capabilityJourney} ref={journeyRef}>
      {CORE_CAPABILITIES.map((capability, index) => (
        <section
          className={styles.journeyStep}
          data-core-app-step
          key={capability.name}
        >
          <div className={styles.cubeAnchor}>
            <article className={styles.capabilityCube}>
              <div className={`${styles.cubeFace} ${styles.cubeFront}`}>
                <span className={styles.capabilityIndex}>0{index + 1}</span>
                <Image
                  alt={`${capability.name} icon`}
                  height={200}
                  src={capability.icon}
                  width={200}
                />
                <div>
                  <p className={styles.capabilityLabel}>Core app</p>
                  <h3>{capability.name}</h3>
                  <p className={styles.capabilityDescription}>
                    {capability.description}
                  </p>
                  <p className={styles.rotateHint}>Scroll to reveal more</p>
                </div>
              </div>

              <div className={`${styles.cubeFace} ${styles.cubeBack}`}>
                <span className={styles.capabilityIndex}>0{index + 1}</span>
                <div className={styles.capabilityDetails}>
                  <p className={styles.capabilityLabel}>Inside {capability.name}</p>
                  <h3>{capability.promise}</h3>
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
              </div>
              <div className={`${styles.cubeEdge} ${styles.cubeEdgeTop}`} />
              <div className={`${styles.cubeEdge} ${styles.cubeEdgeSide}`} />
            </article>
          </div>
        </section>
      ))}
    </div>
  );
}
