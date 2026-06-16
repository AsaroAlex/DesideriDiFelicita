import { site } from '../data/site';

/**
 * Costruisce il JSON-LD schema.org "HairSalon" a partire dai dati centralizzati.
 *
 * REGOLA DI SICUREZZA: i dati marcati come NON confermati in `site.confirmed`
 * vengono OMESSI dallo schema, così non pubblichiamo informazioni incerte come
 * definitive. Se un campo manca, semplicemente non compare (build sempre valida).
 */
export function buildHairSalonSchema(
  canonicalUrl: string,
  ogImageUrl?: string | null
): Record<string, unknown> {
  const c = site.confirmed;

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: site.businessName,
    url: canonicalUrl,
    description: site.description,
  };

  if (ogImageUrl) schema.image = ogImageUrl;

  if (c.priceRange && site.priceRange) schema.priceRange = site.priceRange;

  if (c.phone && site.phone) schema.telephone = site.phone;

  if (c.address && site.address.street) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.city,
      addressRegion: site.address.province,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    };
  }

  if (c.coordinates && (site.coordinates.lat !== 0 || site.coordinates.lng !== 0)) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: site.coordinates.lat,
      longitude: site.coordinates.lng,
    };
  }

  if (c.openingHours && site.openingHours.length > 0) {
    schema.openingHoursSpecification = site.openingHours.map((o) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: o.days,
      opens: o.opens,
      closes: o.closes,
    }));
  }

  // Profili social verificabili (Instagram è un link ufficiale confermato).
  const sameAs = [site.social.instagram, site.social.facebook].filter(Boolean);
  if (sameAs.length > 0) schema.sameAs = sameAs;

  // Partita IVA (segnale di legittimità per l'attività locale).
  if (site.legal.vatNumber) schema.vatID = site.legal.vatNumber;

  return schema;
}

/** Schema BreadcrumbList (gli `url` devono essere assoluti). */
export function buildBreadcrumbSchema(
  items: { name: string; url: string }[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/** Schema FAQPage per le domande frequenti (ottimo per i risultati ricchi). */
export function buildFaqSchema(
  faqs: { q: string; a: string }[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
