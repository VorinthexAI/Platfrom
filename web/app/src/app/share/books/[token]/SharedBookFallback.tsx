"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@vorinthex/shared/ui/components";
import { ArrowRightIcon } from "@vorinthex/shared/ui/icons";
import { DownloadAppCta } from "@/components/core/DownloadAppCta";
import styles from "./SharedBookFallback.module.css";

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type LinkState = "checking" | "active" | "unavailable";

type ShareEventSource = {
  addEventListener: (
    type: "access",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
  close: () => void;
  onerror: ((event: Event) => unknown) | null;
};

type ShareValidationDependencies = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  openEventSource: (url: string) => ShareEventSource;
};

export function isValidShareToken(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}

function isInactiveAccessPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    "status" in value && value.status === "inactive";
}

export function startShareLinkValidation(
  token: string,
  setState: (state: LinkState) => void,
  dependencies: ShareValidationDependencies = {
    fetch: (input, init) => globalThis.fetch(input, init),
    openEventSource: (url) => new EventSource(url),
  },
): () => void {
  const abortController = new AbortController();
  let disposed = false;
  let eventSource: ShareEventSource | undefined;

  void dependencies.fetch("/api/v1/public/books/shares/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    credentials: "omit",
    signal: abortController.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error("Share validation failed");

    const payload: unknown = await response.json().catch(() => undefined);
    if (disposed) return;
    if (isInactiveAccessPayload(payload)) {
      setState("unavailable");
      return;
    }

    eventSource = dependencies.openEventSource(
      `/api/v1/public/books/shares/stream?token=${encodeURIComponent(token)}`,
    );
    eventSource.addEventListener("access", (event) => {
      try {
        if (isInactiveAccessPayload(JSON.parse(event.data))) {
          eventSource?.close();
          if (!disposed) setState("unavailable");
        }
      } catch {
        // Ignore malformed events and wait for a valid access update.
      }
    });
    eventSource.onerror = () => undefined;
    setState("active");
  }).catch(() => {
    if (!disposed) setState("unavailable");
  });

  return () => {
    disposed = true;
    abortController.abort();
    eventSource?.close();
  };
}

export function SharedBookFallback({ token }: { token?: string }) {
  const [state, setState] = useState<LinkState>(token ? "checking" : "unavailable");

  useEffect(() => {
    if (!token) return;
    return startShareLinkValidation(token, setState);
  }, [token]);

  const isActive = state === "active";
  const openAppUrl = token
    ? `vorinthexcore://share/books/${encodeURIComponent(token)}`
    : undefined;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Vorinthex AI home">
          <Image alt="" height={38} src="/logos/vorinthex-mark.png" width={38} />
          <span>Vorinthex AI</span>
        </Link>
        <span className={styles.privateLabel}>Private share</span>
      </header>

      <main className={styles.main}>
        <div aria-hidden="true" className={styles.orbit} />
        <section className={styles.panel}>
          <div className={styles.bookVisual} aria-hidden="true">
            <div className={styles.bookSpine} />
            <div className={styles.bookCover}>
              <Image alt="" height={46} src="/logos/vorinthex-mark.png" width={46} />
              <span>Shared audio book</span>
            </div>
            <div className={styles.bookPages} />
          </div>

          <div className={styles.copy}>
            <p className={styles.eyebrow}>An audio book has been shared with you</p>
            <h1>Continue in Vorinthex</h1>
            {state === "checking" ? (
              <p className={styles.status} role="status">
                Checking that this private share is still available...
              </p>
            ) : isActive ? (
              <p className={styles.status}>
                This shared audio book opens in Vorinthex, where it can be listened to in its
                intended experience.
              </p>
            ) : (
              <div className={styles.unavailable} role="alert">
                <strong>Shared audio book unavailable</strong>
                <span>This link is invalid, expired, or no longer active.</span>
              </div>
            )}

            <div className={styles.actions}>
              {isActive && openAppUrl ? (
                <Button asChild size="lg" variant="primary">
                  <a href={openAppUrl}>
                    Open app
                    <ArrowRightIcon aria-hidden size="sm" />
                  </a>
                </Button>
              ) : (
                <Button disabled size="lg" variant="primary">
                  Open app
                </Button>
              )}
              <DownloadAppCta />
            </div>
            <p className={styles.note}>Install Vorinthex first if the app does not open.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
