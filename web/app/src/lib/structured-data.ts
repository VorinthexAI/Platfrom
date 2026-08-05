import { CORE_FAQ } from "@/lib/core";
import {
  SPARK_MONTHLY_PLANS,
  SPARK_ON_DEMAND,
  SPARK_TOP_UPS,
} from "@/lib/spark-pricing";
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
  offers: [
    {
      "@type": "Offer",
      name: "Newcomer Sparks",
      availability: "https://schema.org/InStock",
      price: "0",
      priceCurrency: "USD",
      url: absoluteUrl("/pricing"),
    },
    ...SPARK_MONTHLY_PLANS.map((plan) => ({
      "@type": "Offer",
      name: `${plan.name} monthly Sparks plan`,
      description: `${plan.sparks.toLocaleString("en-US")} Sparks per month`,
      availability: "https://schema.org/InStock",
      price: plan.price.toFixed(2),
      priceCurrency: "USD",
      url: absoluteUrl("/pricing"),
    })),
    ...SPARK_TOP_UPS.map((topUp) => ({
      "@type": "Offer",
      name: `${topUp.sparks.toLocaleString("en-US")} Sparks top-up`,
      availability: "https://schema.org/InStock",
      price: topUp.price.toFixed(2),
      priceCurrency: "USD",
      url: absoluteUrl("/pricing"),
    })),
    {
      "@type": "Offer",
      name: SPARK_ON_DEMAND.name,
      description: `${SPARK_ON_DEMAND.allowance}; requires ${SPARK_ON_DEMAND.requiresPlan}`,
      availability: "https://schema.org/InStock",
      url: absoluteUrl("/pricing"),
    },
  ],
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
