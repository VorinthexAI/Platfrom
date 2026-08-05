import { CORE_FAQ } from "@/lib/core";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  slogan: "Your Personal AI",
  url: SITE_URL,
  logo: absoluteUrl("/logos/vorinthex-mark.png"),
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "contact@vorinthex.com",
    url: absoluteUrl("/contact"),
  },
};

export const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
};

export const coreSoftwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Vorinthex Core",
  description:
    "A private personal AI that connects your knowledge, memories, communication, discovery, and growth.",
  url: SITE_URL,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "iOS, Android",
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  offers: {
    "@type": "Offer",
    availability: "https://schema.org/InStock",
    price: "0",
    priceCurrency: "USD",
  },
};

export const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: CORE_FAQ.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};
