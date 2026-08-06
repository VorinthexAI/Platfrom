import Image from "next/image";
import { BrainIcon, ShieldIcon, StarIcon } from "@vorinthex/shared/ui/icons";
import { CORE_CAPABILITIES } from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SiteNeuralBackdrop } from "@/components/site/SiteNeuralBackdrop";
import { CoreAppsDepthScene } from "./CoreAppsDepthScene";
import { CoreNeuralScene } from "./CoreNeuralScene";
import { DownloadAppCta } from "./DownloadAppCta";
import styles from "./CorePage.module.css";

export function CorePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <SiteNeuralBackdrop />
      <div className={styles.neuralBackdrop}>
        <CoreNeuralScene />
      </div>

      <section className={styles.hero} id="overview">
        <div className={styles.heroCopy}>
          <h1>Your personal AI.</h1>
          <p className={styles.heroLead}>Everything. Intelligently connected.</p>
          <div className={styles.rule} />
          <p className={styles.heroBody}>
            Vorinthex Core is your personal AI that remembers, understands and
            connects everything that matters to you.
          </p>
          <DownloadAppCta />
        </div>

        <div className={styles.coreVisual} aria-hidden="true" />
      </section>

      <section className={styles.capabilities} id="capabilities">
        <div className={styles.depthStage} aria-hidden="true">
          <CoreAppsDepthScene />
        </div>
        <div className={styles.appsContent}>
          <div className={styles.sectionHeading}>
            <span />
            <div>
              <p>One intelligence, five connected spaces</p>
              <h2>Core Apps</h2>
            </div>
            <span />
          </div>
          <p className={styles.appsIntroduction}>
            Move through the parts of your life without losing context. Every app
            adds understanding to the same private personal AI.
          </p>
          <div className={styles.capabilityJourney}>
            {CORE_CAPABILITIES.map((capability, index) => (
              <article className={styles.capabilityCard} key={capability.name}>
                <div className={styles.capabilityIndex}>0{index + 1}</div>
                <Image
                  alt={`${capability.name} icon`}
                  height={180}
                  src={capability.icon}
                  width={180}
                />
                <div className={styles.capabilityCopy}>
                  <p className={styles.capabilityLabel}>Core app</p>
                  <h3>{capability.name}</h3>
                  <p>{capability.description}</p>
                  <ul>
                    {capability.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
          <div className={styles.comingSoon} aria-label="More Core apps coming soon">
            <Image alt="" height={34} src="/logos/vorinthex-mark.png" width={34} />
            <p>More coming soon</p>
          </div>
        </div>
      </section>

      <section className={styles.principles} id="principles">
        <div className={styles.principlesCopy}>
          <h2>One AI. Every capability. Always with you.</h2>
          <div className={styles.rule} />
          <div className={styles.principleGrid}>
            <article>
              <BrainIcon aria-hidden size="lg" />
              <h3>One intelligence</h3>
              <p>All your data, conversations, images and knowledge in one place.</p>
            </article>
            <article>
              <ShieldIcon aria-hidden size="lg" />
              <h3>Private by design</h3>
              <p>Your data is yours. End-to-end encryption and full control.</p>
            </article>
            <article>
              <StarIcon aria-hidden size="lg" />
              <h3>Built for you</h3>
              <p>Contextual, proactive and personal. Built to amplify your potential.</p>
            </article>
          </div>
        </div>

        <div className={styles.phone} aria-label="Core mobile app preview">
          <div className={styles.phoneSpeaker} />
          <div className={styles.phoneScreen}>
            <div className={styles.phoneBrand}>Vorinthex AI</div>
            <p>Good morning, Oscar.</p>
            <small>How can I help you today?</small>
            <div className={styles.phoneCapabilities}>
              {CORE_CAPABILITIES.map((capability) => (
                <div key={capability.name}>
                  <Image alt="" height={38} src={capability.icon} width={38} />
                  <span>{capability.name}</span>
                </div>
              ))}
            </div>
            <div className={styles.phoneInsight}>
              <small>Recent insight</small>
              <strong>Project Nexus Update</strong>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
