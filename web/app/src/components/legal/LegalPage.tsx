import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import type { VaultCopy } from "@/lib/legal-copy";
import styles from "./LegalPage.module.css";

export function LegalPage({ copy }: { copy: VaultCopy }) {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <article className={styles.content}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        {copy.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {copy.sections?.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <p className={styles.footnote}>{copy.footnote}</p>
        <Button asChild size="md" variant="outline">
          <Link href="/">Go back</Link>
        </Button>
      </article>
      <SiteFooter />
    </main>
  );
}
