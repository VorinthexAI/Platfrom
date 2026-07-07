export const LANDING_EVENT_SLUGS = [
  "landing.page_viewed",
  "landing.product_entered",
  "landing.orchestrator_entered",
  "landing.capability_entered",
  "landing.rock_entered",
  "landing.cta_clicked",
  "landing.cave_opened",
  "landing.cave_closed",
  "landing.audio_played",
  "landing.fragment_discovered",
  "landing.fragment_claim_clicked",
  "landing.fragment_join_to_claim_clicked",
  "waitlist.form_started",
  "waitlist.submit_clicked",
  "waitlist.signup_submitted",
  "waitlist.email_verified",
  "auth.signin_opened",
  "auth.member_gate_opened",
  "legal.opened",
  "fragments.collected",
] as const;

export type LandingEventSlug = (typeof LANDING_EVENT_SLUGS)[number];
