/**
 * Public company and legal copy.
 */

export interface VaultCopy {
  title: string;
  eyebrow: string;
  paragraphs: string[];
  sections?: Array<{
    title: string;
    paragraphs: string[];
  }>;
  footnote: string;
  email?: string;
}

export const PRIVACY_COPY: VaultCopy = {
  title: "Privacy Policy",
  eyebrow: "Records Vault",
  paragraphs: [
    "Effective August 6, 2026. This policy explains how Vorinthex AI handles personal data across its website, apps, and services.",
  ],
  sections: [
    {
      title: "Data we collect",
      paragraphs: [
        "On the current website, we collect information you choose to send us, such as email communications. We may also collect technical data needed to operate and secure the site, such as IP address, device and browser information, diagnostics, and security logs.",
        "For accounts, apps, and AI features, this policy applies to account details and content you choose to provide through those services. We update this page when needed to describe features accurately.",
      ],
    },
    {
      title: "How we use data",
      paragraphs: [
        "We use website data to respond to requests, communicate with you, operate and secure the site, prevent abuse, comply with law, and enforce our terms. We also use account data to create and secure accounts and provide requested features.",
      ],
    },
    {
      title: "How we share data",
      paragraphs: [
        "We share data only as needed with service providers that support hosting, authentication, email, analytics, customer support, security, and AI features. When a feature uses an external AI model provider, the content submitted to that feature may be processed by that provider to return the requested result. We may also share data at your direction, to comply with law, protect rights and safety, or as part of a business reorganization.",
        "We do not sell personal data or share it with third parties for targeted advertising.",
      ],
    },
    {
      title: "Delete your account and data",
      paragraphs: [
        "To request deletion of personal data you have provided to Vorinthex AI, email contact@vorinthex.com from the relevant address and describe the data involved. We may verify your identity before completing the request.",
        "After verification, we delete or deidentify covered data within 30 days. Copies in encrypted backups are removed through the normal backup cycle within 90 days. We may retain limited fraud prevention, security, or legal records for as long as required by law or reasonably necessary to establish or defend legal claims.",
      ],
    },
    {
      title: "Delete selected data without deleting your account",
      paragraphs: [
        "To request deletion of specific data, email contact@vorinthex.com from the relevant address and clearly identify what you want removed. We will delete or deidentify covered data within 30 days after verification, with backup copies expiring within 90 days, subject to the limited legal and security retention described above.",
      ],
    },
    {
      title: "Retention",
      paragraphs: [
        "We retain personal data only for as long as needed for the purposes described in this policy. Retention periods depend on the type of data, security needs, contractual obligations, and legal requirements. When data is no longer needed, we delete or deidentify it.",
      ],
    },
    {
      title: "Your privacy choices and rights",
      paragraphs: [
        "Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a copy of your personal data, and to withdraw consent where processing relies on consent. Make a request by emailing contact@vorinthex.com from the relevant address. You may also have the right to complain to your local data protection authority.",
      ],
    },
    {
      title: "Security and international processing",
      paragraphs: [
        "We use administrative, technical, and organizational safeguards designed to protect personal data. No system is completely secure, so we cannot guarantee absolute security. Vorinthex AI and its service providers may process data in countries other than your own, with safeguards used where required by applicable law.",
      ],
    },
    {
      title: "Children",
      paragraphs: [
        "Vorinthex AI services are not directed to children under 13, or under the higher minimum age required in their country. We do not knowingly collect personal data from children below that age. Contact us if you believe a child has provided personal data so we can investigate and delete it.",
      ],
    },
    {
      title: "Changes and contact",
      paragraphs: [
        "We may update this policy as our services or legal obligations change. We will post the updated policy here and revise its effective date, and we will provide additional notice when required.",
        "For privacy questions or requests, contact Vorinthex AI at contact@vorinthex.com.",
      ],
    },
  ],
  footnote: "Privacy requests: contact@vorinthex.com.",
};

export const TERMS_COPY: VaultCopy = {
  title: "Terms",
  eyebrow: "Accord Vault",
  paragraphs: [
    "These terms govern your use of the Vorinthex AI website, apps, and services.",
    "Additional or updated terms may apply to specific Vorinthex apps, services, or AI-assisted features. When using an AI-assisted feature, you remain responsible for reviewing outputs before relying on them for important decisions.",
    "The Vorinthex AI name, marks, visual identity, software, and original content are the property of Vorinthex AI or its licensors.",
  ],
  footnote: "Questions? Reach us at contact@vorinthex.com.",
};

export const CONTACT_COPY: VaultCopy = {
  title: "Contact",
  eyebrow: "Signal Vault",
  paragraphs: [
    "Questions about access, press, partnerships, or removing your data all go to the same inbox.",
    "Reach the Vorinthex AI team at contact@vorinthex.com.",
  ],
  footnote: "One address answers everything.",
  email: "contact@vorinthex.com",
};
