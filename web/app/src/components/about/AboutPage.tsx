import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { PRODUCT_PILLARS } from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SiteNeuralBackdrop } from "@/components/site/SiteNeuralBackdrop";
import styles from "./AboutPage.module.css";

const PRINCIPLES = [
  {
    number: "01",
    title: "Personal by default",
    body: "Core is built around your context, not a generic workspace shared by everyone.",
  },
  {
    number: "02",
    title: "Private by design",
    body: "Your personal intelligence should remain yours, with protection and control built in.",
  },
  {
    number: "03",
    title: "Connected by nature",
    body: "Files, chats, and Core share one space, so what you keep can become the next answer.",
  },
] as const;

export function AboutPage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <SiteNeuralBackdrop />
      <main id="main-content" tabIndex={-1}>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>About Vorinthex AI</p>
          <h1>Intelligence should know you.</h1>
          <p className={styles.lead}>
            Vorinthex AI is an AI-native software company focused on Core: one
            personal AI for iOS and Android that starts from the work you keep.
          </p>
        </div>
        <div className={styles.heroMark}>
          <div />
          <Image
            alt="Vorinthex AI emblem"
            height={420}
            priority
            src="/logos/vorinthex-mark.png"
            width={420}
          />
        </div>
      </section>

      <section className={styles.mission}>
        <p className={styles.eyebrow}>Our mission</p>
        <h2>Make personal intelligence practical, private, and deeply useful.</h2>
        <p>
          Today, meaningful work is scattered across notes, photos, documents,
          and conversations. People are forced to move between disconnected
          tools that repeatedly forget who they are and what matters. Core is
          our answer: one personal AI that starts from the files you choose to
          keep.
        </p>
      </section>

      <section className={styles.principles}>
        <h2 className={styles.eyebrow}>Our principles</h2>
        {PRINCIPLES.map((principle) => (
          <article key={principle.number}>
            <span>{principle.number}</span>
            <h3>{principle.title}</h3>
            <p>{principle.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.coreStory}>
        <div className={styles.coreCopy}>
          <p className={styles.eyebrow}>Built as one Core</p>
          <h2>Storage. Core. Sparks.</h2>
          <p>
            Keep your work in Storage. Ask Core, and it can search what you have
            kept, continue a conversation, or create images, speech, and short
            videos. Sparks are one balance for Storage and Core.
          </p>
        </div>
        <div className={styles.capabilityMarks}>
          {PRODUCT_PILLARS.map((pillar) => (
            <div key={pillar.name}>
              <span>{pillar.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.foundation}>
        <Image
          alt="Vorinthex Core emblem"
          height={280}
          src="/logos/entities/product-core.png"
          width={280}
        />
        <div>
          <p className={styles.eyebrow}>Built for the long term</p>
          <h2>From context to action, in one place.</h2>
          <p>
            Vorinthex Core is built for iOS and Android. The technology can
            evolve; the product principle stays constant: personal AI should
            remain centered on the context and controls its user provides.
          </p>
          <Button asChild size="lg" variant="outline">
            <Link href="/#download">Get the app</Link>
          </Button>
        </div>
      </section>

      </main>
      <SiteFooter />
    </div>
  );
}
