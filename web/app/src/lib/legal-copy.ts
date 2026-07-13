/**
 * Static vault copy, shared between the SEO-visible page bodies and the
 * in-galaxy caverns (privacy/terms/about/contact are read inside asteroid
 * biomes, not on separate flat pages).
 */

export interface VaultCopy {
  title: string;
  eyebrow: string;
  paragraphs: string[];
  footnote: string;
}

export const PRIVACY_COPY: VaultCopy = {
  title: "Privacy",
  eyebrow: "Records Vault",
  paragraphs: [
    "Vorinthex AI collects only the email address you submit when joining The Hunt or signing in. It is used solely to contact you about access to Vorinthex AI products.",
    "We do not sell your data. We do not share it with third parties for advertising. You can request removal at any time by contacting contact@vorinthex.com.",
    "A full privacy policy will be published before Core launches.",
  ],
  footnote: "Questions? Reach us at contact@vorinthex.com.",
};

export const TERMS_COPY: VaultCopy = {
  title: "Terms",
  eyebrow: "Accord Vault",
  paragraphs: [
    "Joining The Hunt does not guarantee access to Vorinthex AI products. Access is granted in waves as capacity allows.",
    "Intelligence Fragments are a promotional collectible, not money or a currency. They carry no monetary value and cannot be bought, sold, or exchanged.",
    "The Vorinthex AI name, marks, and visual identity are the property of Vorinthex AI. Full terms of service will be published before Core launches.",
  ],
  footnote: "Questions? Reach us at contact@vorinthex.com.",
};

export const ABOUT_COPY: VaultCopy = {
  title: "About",
  eyebrow: "Origin Vault",
  paragraphs: [
    "Vorinthex is an AI-native software company building a unified AI platform for consumers, founders, creators, and businesses.",
    "Our mission is to make AI practical, accessible, and deeply integrated into everyday work by replacing fragmented AI tools with one intelligent ecosystem.",
    "Today we are building Core, a personal AI Brain that learns, remembers, and grows with each user. Over time, Core will expand through AI Capabilities for memory, communication, productivity, creativity, discovery, and personal growth.",
    "Alongside Core, we are developing Command, an AI executive team with specialized business orchestrators; Studio, a unified workspace for chat, image, video, music, code, documents, and research; and Launch, a platform for building, deploying, and managing AI agents and automations.",
    "Vorinthex is designed as a global AI-native platform, built on modern cloud infrastructure and connected to leading foundation models so users can move from idea to action without stitching together disconnected tools.",
    "We are currently in active development and onboarding early users through our waitlist.",
  ],
  footnote: "Questions? Reach us at contact@vorinthex.com.",
};

export const CONTACT_COPY: VaultCopy = {
  title: "Contact",
  eyebrow: "Signal Vault",
  paragraphs: [
    "Questions, access, press, partnerships, or removing your data — it all lands in the same inbox, and we read everything.",
    "Reach the Vorinthex team at contact@vorinthex.com.",
  ],
  footnote: "One address answers everything.",
};
