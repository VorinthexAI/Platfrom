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
}

export const PRIVACY_COPY: VaultCopy = {
  title: "Privacy Policy",
  eyebrow: "Records Vault",
  paragraphs: [
    "Effective July 15, 2026. This policy explains how Vorinthex AI collects, uses, shares, retains, and protects personal data when you use our websites, apps, and services.",
  ],
  sections: [
    {
      title: "Data we collect",
      paragraphs: [
        "We collect account and profile data such as your email address, name or alias, profile details, sign in identifiers, preferences, and waitlist status. We also collect content and activity you choose to provide, including prompts, files, messages, saved content, feedback, and communications with us.",
        "We may collect technical and usage data such as IP address, device and browser information, cookie or similar identifiers, app interactions, diagnostics, and security logs. If you make a purchase, we receive transaction details such as the product, plan, payment status, and billing contact information. Payment providers process complete payment card details on our behalf.",
      ],
    },
    {
      title: "How we use data",
      paragraphs: [
        "We use personal data to create and secure accounts, provide and personalize Vorinthex AI services, process requests and purchases, communicate about access and service updates, provide support, measure and improve performance, prevent fraud and abuse, comply with law, and enforce our terms.",
      ],
    },
    {
      title: "How we share data",
      paragraphs: [
        "We share data only as needed with service providers that support hosting, authentication, email, analytics, customer support, payments, security, and AI features. When a feature uses an external AI model provider, the content submitted to that feature may be processed by that provider to return the requested result. We may also share data at your direction, to comply with law, protect rights and safety, or as part of a business reorganization.",
        "We do not sell personal data or share it with third parties for targeted advertising.",
      ],
    },
    {
      title: "Delete your account and data",
      paragraphs: [
        "You can request deletion of your account and its associated data by signing in, opening your Profile page, selecting Delete account, and confirming the request. If you cannot sign in, email contact@vorinthex.com from the address associated with your account and ask us to delete the account. We may verify your identity before completing the request.",
        "Account deletion removes or deidentifies your profile, saved content, and account activity within 30 days after verification. Copies in encrypted backups are removed through the normal backup cycle within 90 days. We may retain limited transaction, fraud prevention, security, or legal records for as long as required by law or reasonably necessary to establish or defend legal claims.",
      ],
    },
    {
      title: "Delete selected data without deleting your account",
      paragraphs: [
        "You may request deletion of specific data while keeping your account. Use the available controls on your Profile page, or email contact@vorinthex.com from your account email and clearly identify the profile field, saved content, conversation, file, activity record, or other data you want removed. We will delete or deidentify the selected data within 30 days after verification, with backup copies expiring within 90 days, subject to the same limited legal, security, and transaction retention described above.",
      ],
    },
    {
      title: "Retention",
      paragraphs: [
        "We keep account data while your account is active and retain other personal data only for as long as needed for the purposes described in this policy. Retention periods depend on the type of data, the service involved, security needs, contractual obligations, and legal requirements. When data is no longer needed, we delete or deidentify it.",
      ],
    },
    {
      title: "Your privacy choices and rights",
      paragraphs: [
        "Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a copy of your personal data, and to withdraw consent where processing relies on consent. You may make a request through your Profile page or by emailing contact@vorinthex.com. You may also have the right to complain to your local data protection authority.",
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
    "These terms govern your use of Vorinthex AI websites, apps, and services. By using a Vorinthex AI service, you agree to use it lawfully and responsibly.",
    "Vorinthex Core provides AI assisted features. You remain responsible for reviewing outputs before relying on them for important decisions.",
    "The Vorinthex AI name, marks, visual identity, software, and original content are the property of Vorinthex AI or its licensors.",
  ],
  footnote: "Questions? Reach us at contact@vorinthex.com.",
};

export const CONTACT_COPY: VaultCopy = {
  title: "Contact",
  eyebrow: "Signal Vault",
  paragraphs: [
    "Questions about access, press, partnerships, or removing your data all land in the same inbox. We read everything.",
    "Reach the Vorinthex AI team at contact@vorinthex.com.",
  ],
  footnote: "One address answers everything.",
};
