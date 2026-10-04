export interface LegalCopy {
  title: string;
  eyebrow?: string;
  paragraphs: string[];
  sections?: Array<{
    title: string;
    paragraphs: string[];
  }>;
  footnote: string;
  email?: string;
}

export const LEGAL_EFFECTIVE_DATE_ISO = "2026-10-04";
export const LEGAL_EFFECTIVE_DATE = `Effective ${new Date(`${LEGAL_EFFECTIVE_DATE_ISO}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
export const LEGAL_CONTACT_EMAIL = "contact@vorinthex.com";

const UNFUNDED_STORAGE_COPY = "Storage is charged from prepaid Sparks hourly. If the available balance cannot cover storage, no debt or grace-period backcharges accrue and uploads can continue. Existing data remains available for export, deletion, and recovery before deletion begins. Adding enough Sparks before deletion begins restores prospective storage charging. After 90 consecutive days without enough Sparks to cover storage, stored files and media are permanently deleted; adding Sparks after deletion begins cannot restore them.";

export const PRIVACY_COPY: LegalCopy = {
  title: "Privacy Policy",
  eyebrow: LEGAL_EFFECTIVE_DATE,
  paragraphs: [
    "This policy explains how Vorinthex AI collects, uses, and protects personal data when you use our website, mobile app, and services.",
  ],
  sections: [
    {
      title: "Data we collect",
      paragraphs: [
        "We collect information you provide, such as your name, email address, support messages, files, media, and Core chats. We also process information about your account, scopes, subscriptions, Spark transactions, and use of the services.",
        "We collect technical information needed to operate and secure the services, such as IP address, device and browser information, diagnostics, and security logs. Payment checkout is handled by a payment provider; we do not ask you to enter payment card details in the app.",
      ],
    },
    {
      title: "How we use data",
      paragraphs: [
        "We use this information to create and secure accounts, store and organize your content, provide Core and other requested features, process subscriptions and Spark charges, respond to support requests, prevent abuse, and comply with legal obligations.",
      ],
    },
    {
      title: "How we share data",
      paragraphs: [
        "We share data as needed with providers that support hosting, storage, authentication, payments, email, analytics, customer support, security, and AI features. Content submitted to an AI feature may be processed by an external model provider to return the requested result. We may also share data at your direction, to comply with law, protect rights and safety, or as part of a business reorganization.",
        "We do not sell personal data or share it with third parties for targeted advertising.",
      ],
    },
    {
      title: "Delete your account and data",
      paragraphs: [
        `You can delete your account in the app's Settings. You can also email ${LEGAL_CONTACT_EMAIL} from the relevant address to request account or data deletion. We may verify your identity before acting on an emailed request.`,
        "After verification, we delete or deidentify covered data within 30 days. Copies in encrypted backups are removed through the normal backup cycle within 90 days. We may retain limited fraud prevention, security, or legal records for as long as required by law or reasonably necessary to establish or defend legal claims.",
      ],
    },
    {
      title: "Delete selected data without deleting your account",
      paragraphs: [
        `You can delete individual files and folders in the app without deleting your account. For other specific data, email ${LEGAL_CONTACT_EMAIL} from the relevant address and identify what you want removed. After verification, we delete or deidentify covered data within 30 days, with backup copies expiring within 90 days, subject to the limited retention described above.`,
      ],
    },
    {
      title: "Retention",
      paragraphs: [
        "We retain personal data only for as long as needed for the purposes described in this policy. Retention periods depend on the type of data, security needs, contractual obligations, and legal requirements. When data is no longer needed, we delete or deidentify it.",
        UNFUNDED_STORAGE_COPY,
      ],
    },
    {
      title: "Your privacy choices and rights",
      paragraphs: [
        `Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a copy of your personal data, and to withdraw consent where processing relies on consent. Make a request by emailing ${LEGAL_CONTACT_EMAIL} from the relevant address. You may also have the right to complain to your local data protection authority.`,
      ],
    },
    {
      title: "Security and international processing",
      paragraphs: [
        "Vorinthex AI hosts and processes personal data in the United States. If you access the services from outside the United States, your personal data may be transferred to, stored in, and processed in the United States and other countries where Vorinthex AI or its service providers operate. Those countries may have data-protection laws different from those in your country.",
        "We use administrative, technical, and organizational safeguards designed to protect personal data, including safeguards for international transfers where required by applicable law. No system is completely secure, so we cannot guarantee absolute security.",
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
        "We may update this policy as our services or legal obligations change. We will post the updated policy here and revise its effective date.",
        `For privacy questions or requests, contact Vorinthex AI at ${LEGAL_CONTACT_EMAIL}.`,
      ],
    },
  ],
  footnote: `Privacy requests: ${LEGAL_CONTACT_EMAIL}.`,
};

export const TERMS_COPY: LegalCopy = {
  title: "Terms of Service",
  eyebrow: LEGAL_EFFECTIVE_DATE,
  paragraphs: [
    "These terms govern your use of the Vorinthex AI website, mobile app, and services. Our Privacy Policy explains how we handle your personal data, including processing in the United States and international transfers.",
  ],
  sections: [
    {
      title: "Your account and content",
      paragraphs: [
        "You are responsible for the content you upload or submit and for keeping your account access secure. You can organize content in scopes and delete individual files and folders in the app.",
        "Core can use content available in your current scope to answer questions or create content. AI-generated results may be inaccurate; review them before relying on them for important decisions.",
      ],
    },
    {
      title: "Sparks, subscriptions, and storage",
      paragraphs: [
        "Sparks are prepaid credits for eligible services. Charges depend on the feature and usage; current prices and subscription options are shown before purchase or use. Prepaid Sparks remain available after you cancel a subscription, and Spark balances never go below zero.",
        "Canceling a subscription stops future renewals at the end of its current period. It does not delete your account or content.",
        UNFUNDED_STORAGE_COPY,
      ],
    },
    {
      title: "Closing your account",
      paragraphs: [
        "You can delete your account in the app's Settings. If a payment checkout is pending, you may need to complete it or wait for it to expire before account deletion can finish. See the Privacy Policy for information about data deletion and retention.",
      ],
    },
    {
      title: "Changes and contact",
      paragraphs: [
        "We may update these terms as the services change. The latest version and its effective date are published here.",
        `The Vorinthex AI name, marks, visual identity, software, and original content belong to Vorinthex AI or its licensors. Questions about these terms can be sent to ${LEGAL_CONTACT_EMAIL}.`,
      ],
    },
  ],
  footnote: `Questions? Reach us at ${LEGAL_CONTACT_EMAIL}.`,
};

export const CONTACT_COPY: LegalCopy = {
  title: "Contact",
  eyebrow: "Vorinthex AI",
  paragraphs: [
    `For help with your account, privacy requests, press, or partnerships, email ${LEGAL_CONTACT_EMAIL}.`,
  ],
  footnote: "For account and privacy requests, write from the email address linked to your account.",
  email: LEGAL_CONTACT_EMAIL,
};
