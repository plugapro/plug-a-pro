// Schema.org JSON-LD helpers.
//
// Used by the marketing site to expose structured data for Organization,
// LocalBusiness, Service, BreadcrumbList and FAQPage entities so Google + Bing
// can render rich results for service searches like "electrician near me".
//
// Output is always a plain JSON-serialisable object; embed via:
//   <script
//     type="application/ld+json"
//     dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationLd()) }}
//   />
//
// jsonLdScript() escapes `<` so a closing `</script>` inside any string field
// cannot break out of the script tag.

import { siteConfig } from "./metadata";

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    legalName: siteConfig.legalEntity,
    url: siteConfig.url,
    logo: `${siteConfig.url}/icon.png`,
    sameAs: [siteConfig.links.facebook, siteConfig.links.instagram],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      telephone: siteConfig.whatsappNumber,
      areaServed: "ZA",
      availableLanguage: ["en"],
    },
  };
}

export function localBusinessLd() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: siteConfig.name,
    url: siteConfig.url,
    image: `${siteConfig.url}${siteConfig.ogImage}`,
    telephone: siteConfig.whatsappNumber,
    address: {
      "@type": "PostalAddress",
      addressCountry: "ZA",
      addressRegion: "Gauteng",
    },
    areaServed: "South Africa",
    priceRange: "R-RRR",
  };
}

export function serviceLd(params: {
  name: string;
  description: string;
  slug: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: params.name,
    description: params.description,
    provider: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    areaServed: "South Africa",
    url: `${siteConfig.url}/services/${params.slug}`,
  };
}

export function breadcrumbLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqLd(qa: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

// Escape `<` so a string containing `</script>` cannot break out of the inline
// script tag. JSON encoding already takes care of `&`, `>`, line separators
// and quotes.
export function jsonLdScript(payload: object): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}
