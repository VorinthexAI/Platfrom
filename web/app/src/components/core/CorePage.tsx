import Image from "next/image";
import { BrainIcon, ShieldIcon, StarIcon } from "@vorinthex/shared/ui/icons";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SiteNeuralBackdrop } from "@/components/site/SiteNeuralBackdrop";
import { CoreAppsDepthScene } from "./CoreAppsDepthScene";
import { CoreAppsJourney } from "./CoreAppsJourney";
import { CoreNeuralScene } from "./CoreNeuralScene";
import { DownloadAppCta } from "./DownloadAppCta";
import styles from "./CorePage.module.css";

const HERO_TITLE_WORDS = ["Your", "personal", "AI."] as const;

function HeroTitle() {
  return (
    <h1 aria-label="Your personal AI.">
      {HERO_TITLE_WORDS.map((word, wordIndex) => {
        const characterOffset = HERO_TITLE_WORDS
          .slice(0, wordIndex)
          .reduce((total, item) => total + item.length, 0);

        return (
          <span aria-hidden="true" className={styles.titleWord} key={word}>
            {Array.from(word).map((character, characterIndex) => (
              <span
                className={styles.titleCharacter}
                key={`${character}-${characterIndex}`}
                style={{ animationDelay: `${240 + (characterOffset + characterIndex) * 72}ms` }}
              >
                {character}
              </span>
            ))}
          </span>
        );
      })}
    </h1>
  );
}

export function CorePage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <SiteNeuralBackdrop />
      <div className={styles.neuralBackdrop} aria-hidden="true">
        <CoreNeuralScene />
      </div>

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} id="overview">
          <div className={styles.heroCopy}>
            <HeroTitle />
            <p className={styles.heroLead}>Everything. Intelligently connected.</p>
            <div className={styles.rule} />
            <p className={styles.heroBody}>
              Vorinthex AI is your personal AI that remembers, understands and
              connects everything that matters to you.
            </p>
            <DownloadAppCta />
          </div>

          <div className={styles.coreVisual} aria-hidden="true" />
        </section>

        <section className={styles.capabilities} id="core-apps">
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
              adds understanding to the same personal AI.
            </p>
            <CoreAppsJourney />
          </div>
        </section>

        <section className={styles.principles} id="principles">
          <div className={styles.principlesCopy}>
            <h2>One AI. Always with you.</h2>
            <div className={styles.rule} />
            <div className={styles.principleGrid}>
              <article>
                <BrainIcon aria-hidden size="lg" />
                <h3>One intelligence</h3>
                <p>Connect data, conversations, images, and knowledge.</p>
              </article>
              <article>
                <ShieldIcon aria-hidden size="lg" />
                <h3>Private by design</h3>
                <p>Privacy and user control are principles guiding Core&apos;s design.</p>
              </article>
              <article>
                <StarIcon aria-hidden size="lg" />
                <h3>Built for you</h3>
                <p>Personal context with proactive assistance.</p>
              </article>
            </div>
          </div>

          <div className={styles.phone} aria-hidden="true">
            <div className={styles.phoneSpeaker} />
            <div className={styles.phoneScreen}>
              <Image
                alt=""
                className={styles.phoneLogo}
                height={120}
                src="/logos/vorinthex-mark.png"
                width={120}
              />
            </div>
          </div>
        </section>

      </main>

      <SiteFooter />
    </div>
  );
}
