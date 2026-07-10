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
    "Vorinthex is an AI-native software company building the next generation of productivity tools for the AI era.",
    "Our mission is simple: make AI and autonomous agents accessible, practical, and useful for everyone.",
    "We believe AI shouldn't be fragmented across dozens of disconnected apps. Instead, people should have one intelligent platform where AI can think, collaborate, and help accomplish real work.",
    "Today we're building Core, with Command, Studio, and Launch following as part of the long-term vision.",
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
