import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SiteNeuralBackdrop } from "@/components/site/SiteNeuralBackdrop";
import type { VaultCopy } from "@/lib/legal-copy";
import styles from "./LegalPage.module.css";

export function LegalPage({ copy }: { copy: VaultCopy }) {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <SiteNeuralBackdrop />
      <main id="main-content" tabIndex={-1}>
      <article className={styles.content}>
        <h1>{copy.title}</h1>
        {copy.eyebrow ? <p className={styles.subtitle}>{copy.eyebrow}</p> : null}
        {copy.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {copy.sections?.map((section) => (
          <section key={section.title}>
            <p>{section.title}</p>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <p className={styles.footnote}>{copy.footnote}</p>
        <Button asChild size="md" variant="outline">
          {copy.email ? (
            <a href={`mailto:${copy.email}`}>Email Vorinthex AI</a>
          ) : (
            <Link href="/">Go back</Link>
          )}
        </Button>
      </article>
      </main>
      <SiteFooter />
    </div>
  );
}
