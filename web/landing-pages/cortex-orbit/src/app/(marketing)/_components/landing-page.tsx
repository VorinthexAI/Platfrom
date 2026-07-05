"use client";

import { MotionConfig } from "motion/react";
import { useState } from "react";

import { CtaSection } from "./cta-section";
import { HeroSection } from "./hero-section";
import { ProductPreviewSection } from "./product-preview-section";
import { SignInModal } from "./signin-modal";
import { SignInTriggerPill } from "./signin-trigger-pill";
import { SiteFooter } from "./site-footer";
import { SiteNavbar } from "./site-navbar";
import { StatsSection } from "./stats-section";
import { TestimonialSection } from "./testimonial-section";
import { WaitlistModal } from "./waitlist-modal";

export function LandingPage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-[200] -translate-y-16 rounded-button bg-accent px-4 py-2.5 text-sm font-medium text-background transition-transform duration-200 focus-visible:translate-y-0 focus-visible:outline-none"
      >
        Skip to content
      </a>

      <SiteNavbar onJoinWaitlist={() => setWaitlistOpen(true)} />

      <main id="main-content">
        <HeroSection
          onJoinWaitlist={() => setWaitlistOpen(true)}
          onSignIn={() => setSignInOpen(true)}
        />
        <ProductPreviewSection />
        <StatsSection />
        <TestimonialSection />
        <CtaSection onJoinWaitlist={() => setWaitlistOpen(true)} />
      </main>

      <SiteFooter />

      <SignInTriggerPill onOpen={() => setSignInOpen(true)} />

      <WaitlistModal open={waitlistOpen} onOpenChange={setWaitlistOpen} />
      <SignInModal open={signInOpen} onOpenChange={setSignInOpen} />
    </MotionConfig>
  );
}
