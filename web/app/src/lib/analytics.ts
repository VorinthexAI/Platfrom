"use client";

import type { LandingEventSlug } from "./analytics-events";

type AnalyticsMetadata = Record<string, unknown>;

interface TrackLandingEventInput {
  slug: LandingEventSlug;
  metadata?: AnalyticsMetadata;
}

export function trackLandingEvent({ slug, metadata = {} }: TrackLandingEventInput) {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({
    slug,
    metadata: {
      ...metadata,
      path: window.location.pathname,
      search: window.location.search,
      referrer: document.referrer || null,
    },
  });

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      "/api/events",
      new Blob([body], { type: "application/json" }),
    );
    if (sent) return;
  }

  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function trackCtaClick(action: string, metadata: AnalyticsMetadata = {}) {
  trackLandingEvent({
    slug: "landing.cta_clicked",
    metadata: { action, ...metadata },
  });
}
