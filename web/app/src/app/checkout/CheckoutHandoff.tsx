"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@vorinthex/shared/ui/components";
import { ArrowRightIcon, CheckIcon } from "@vorinthex/shared/ui/icons";
import {
  isAllowedPolarCheckoutUrl,
  isCheckoutHandoffToken,
  type CheckoutResolution,
} from "@/lib/checkout-handoff-contract";
import { PRICING_HERO_BODY } from "@/lib/discoverability";
import styles from "./checkout.module.css";

type CheckoutState =
  | { status: "capturing" }
  | { status: "resolving" }
  | { status: "ready"; resolution: CheckoutResolution }
  | { status: "unavailable"; message: string };

const unavailableMessage = "This checkout link is invalid, expired, or already used. Return to the app to start a new checkout.";

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function captureHandoffFragment(location: Location, history: History): string | undefined {
  const hash = location.hash;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (!hash.startsWith("#handoff=")) return undefined;
  const token = hash.slice("#handoff=".length);
  return isCheckoutHandoffToken(token) ? token : undefined;
}

export function CheckoutHandoff() {
  const tokenRef = useRef<string | undefined>(undefined);
  const [state, setState] = useState<CheckoutState>({ status: "capturing" });
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    const token = captureHandoffFragment(window.location, window.history);
    if (!token) {
      queueMicrotask(() => setState({ status: "unavailable", message: unavailableMessage }));
      return;
    }
    tokenRef.current = token;
    const controller = new AbortController();
    void fetch("/api/checkout/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    }).then(async (response) => {
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok || typeof payload !== "object" || payload === null || !("data" in payload)) throw new Error();
      setState({ status: "ready", resolution: (payload as { data: CheckoutResolution }).data });
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        tokenRef.current = undefined;
        setState({ status: "unavailable", message: unavailableMessage });
      }
    });
    return () => controller.abort();
  }, []);

  async function continueToCheckout() {
    const token = tokenRef.current;
    if (!token || state.status !== "ready") return;
    setContinuing(true);
    try {
      const response = await fetch("/api/checkout/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      const payload: unknown = await response.json().catch(() => undefined);
      const url = typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data?: { url?: unknown } }).data?.url
        : undefined;
      if (!response.ok || !isAllowedPolarCheckoutUrl(url)) throw new Error();
      tokenRef.current = undefined;
      window.location.assign(url);
    } catch {
      tokenRef.current = undefined;
      setContinuing(false);
      setState({ status: "unavailable", message: "We could not open checkout. Return to the app to try again." });
    }
  }

  const resolution = state.status === "ready" ? state.resolution : undefined;
  const product = resolution?.product;
  const period = product?.billingPeriod ? ` / ${product.billingPeriod}` : " one time";

  return (
    <main className={styles.page}>
      <Image aria-hidden className={styles.backdropMark} height={900} priority src="/logos/vorinthex-mark.png" width={900} alt="" />
      <section className={styles.shell} aria-labelledby="checkout-title">
        <header className={styles.brand}>
          <Image height={36} src="/logos/vorinthex-mark.png" width={36} alt="" />
          <span>Vorinthex AI</span>
          <strong>Secure handoff</strong>
        </header>

        <div className={styles.grid}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>Sparks checkout</p>
            <h1 id="checkout-title">Fuel every part of Vorinthex.</h1>
            <p>{PRICING_HERO_BODY}</p>
            <ul>
              <li><CheckIcon aria-hidden size="sm" /> One balance for access to everything</li>
              <li><CheckIcon aria-hidden size="sm" /> Add Sparks through plans or one-time top-ups</li>
              <li><CheckIcon aria-hidden size="sm" /> Hosted securely by Polar</li>
            </ul>
          </div>

          <div className={styles.summary}>
            {state.status === "capturing" || state.status === "resolving" ? (
              <div className={styles.loading} role="status">
                <span aria-hidden />
                <strong>Preparing your selection</strong>
                <p>Confirming the secure handoff from Core.</p>
              </div>
            ) : product && resolution ? (
              <>
                <p className={styles.eyebrow}>Your selection</p>
                <div className={styles.productHeading}>
                  <h2>{product.name}</h2>
                  <span>{product.type === "subscription" ? "Membership" : "Top-up"}</span>
                </div>
                <div className={styles.price}>
                  {product.referencePriceCents ? <s>{formatPrice(product.referencePriceCents, product.currency)}</s> : null}
                  <strong>{formatPrice(product.priceCents, product.currency)}</strong>
                  <span>{period}</span>
                </div>
                <p className={styles.taxNote}>Price excludes VAT and other local taxes. Polar calculates and adds applicable tax at checkout.</p>
                <div className={styles.sparks}>
                  <span>Included usage</span>
                  <strong>{product.sparks.toLocaleString("en-US")} Sparks</strong>
                  <p>{product.billingPeriod ? `Refreshed every ${product.billingPeriod}.` : "Added once to your balance."}</p>
                </div>
                <Button loading={continuing} onClick={continueToCheckout} size="xl" variant="primary">
                  Continue to checkout
                  <ArrowRightIcon aria-hidden size="sm" />
                </Button>
                <p className={styles.expiry}>This private checkout handoff expires at {new Date(resolution.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
              </>
            ) : (
              <div className={styles.unavailable} role="alert">
                <p className={styles.eyebrow}>Checkout unavailable</p>
                <h2>Return to Core to try again.</h2>
                <p>{state.status === "unavailable" ? state.message : unavailableMessage}</p>
                <Button asChild size="lg" variant="secondary"><a href="vorinthexcore://">Open Vorinthex Core</a></Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
