import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { CORE_CAPABILITIES } from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
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
    body: "Knowledge becomes more useful when memories, communication, discovery, and goals understand one another.",
  },
] as const;

export function AboutPage() {
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>About Vorinthex</p>
          <h1>Intelligence should know you.</h1>
          <p className={styles.lead}>
            Vorinthex is an AI-native software company focused on Core: one
            private personal AI that learns, remembers, and grows with you.
          </p>
        </div>
        <div className={styles.heroMark}>
          <div />
          <Image
            alt="Vorinthex emblem"
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
          Today, meaningful context is scattered across notes, photos,
          conversations, places, plans, and routines. People are forced to move
          between disconnected tools that repeatedly forget who they are and
          what matters. Core is our answer: one intelligence that connects that
          context and helps turn it into action.
        </p>
      </section>

      <section className={styles.principles}>
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
          <h2>One foundation. Capabilities that expand with you.</h2>
          <p>
            Core begins with a personal intelligence and expands through focused
            capabilities. Archive, Gallery, Signal, Compass, and Ascend each do
            something distinct, while sharing the context that makes the whole
            system more useful than isolated tools.
          </p>
        </div>
        <div className={styles.capabilityMarks}>
          {CORE_CAPABILITIES.map((capability) => (
            <div key={capability.name}>
              <Image
                alt={`${capability.name} emblem`}
                height={92}
                src={capability.icon}
                width={92}
              />
              <span>{capability.name}</span>
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
            Vorinthex combines modern cloud infrastructure with leading
            foundation models to make Core useful across everyday life. The
            technology can evolve; the product principle stays constant: your
            AI should understand your context and remain centered on you.
          </p>
          <Button asChild size="lg" variant="outline">
            <Link href="/#download">Download Core</Link>
          </Button>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
