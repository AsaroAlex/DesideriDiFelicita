/**
 * UNICA FONTE DI VERITÀ per tutti i dati del salone.
 * ---------------------------------------------------
 * I componenti devono LEGGERE da qui: non duplicare telefono, indirizzo,
 * social, orari o dati SEO direttamente nei componenti.
 *
 * Dati anagrafici/contatti CONFERMATI dall'Instagram ufficiale del salone
 * (@desideri.di.felicita) e dal biglietto da visita del brand.
 * Restano "da confermare" solo: ORARI di apertura, COORDINATE GPS esatte,
 * PREZZI. Finché i relativi flag in `confirmed` sono false:
 *   - il dato non entra nel JSON-LD;
 *   - in pagina compare il badge "da confermare" (orari) o "su richiesta" (prezzi).
 */

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  region: string;
  country: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface OpeningHour {
  days: string[];
  label: string;
  opens: string;
  closes: string;
}

export interface Service {
  name: string;
  description: string;
  price?: string;
}

export interface Review {
  author: string;
  text: string;
  rating?: number;
}

export interface Faq {
  q: string;
  a: string;
}

export const site = {
  // — Identità —
  businessName: 'Desideri di Felicità',
  ownerName: 'Jessica Asaro',
  role: 'Hair Stylist',
  category: 'Parrucchiera · Hair stylist · Salone di bellezza',
  slogan: 'La bellezza nasce da un desiderio, la felicità lo rende reale.',
  tagline: 'Creiamo insieme il tuo momento felice.',
  description:
    'Desideri di Felicità è il salone di parrucchiera di Jessica Asaro a Galliera ' +
    '(BO): taglio donna, uomo e bambino, colore, balayage, cura del capello riccio ' +
    'e trattamenti professionali. Uno spazio accogliente dove ogni look nasce ' +
    'dall’ascolto del tuo desiderio.',

  // — Contatti (confermati) —
  phone: '+39 350 012 5159',
  whatsapp: '+39 350 012 5159',
  email: 'asarojessica92@gmail.com',

  // — Sede (confermata) —
  address: {
    street: 'Piazza Torino Bosi 6',
    city: 'Galliera',
    province: 'BO',
    postalCode: '40015',
    region: 'Emilia-Romagna',
    country: 'IT',
  } satisfies Address,
  coordinates: { lat: 0, lng: 0 } satisfies Coordinates, // GPS esatto da confermare

  // — Orari (placeholder, DA CONFERMARE) —
  openingHours: [
    { days: ['Tuesday', 'Wednesday', 'Thursday', 'Friday'], label: 'Mar–Ven', opens: '09:00', closes: '19:00' },
    { days: ['Saturday'], label: 'Sabato', opens: '09:00', closes: '18:00' },
  ] satisfies OpeningHour[],

  // — Link ufficiali —
  instagramUrl: 'https://www.instagram.com/desideri.di.felicita/',
  googleBusinessUrl: 'https://share.google/f8pi0yJ5BJtgtEYM0',
  driveAssetsUrl: 'https://drive.google.com/drive/folders/1j-x6ktD0Pwf7lszvTbrecCykGlO8rM0f',

  // — Servizi (dall'attività reale; prezzi da confermare) —
  services: [
    { name: 'Taglio donna', description: 'Tagli su misura, studiati sulla forma del viso e sul tuo stile, valorizzando la texture naturale.' },
    { name: 'Cura del riccio', description: 'Tagli e consulenza dedicati ai capelli ricci e mossi, per definizione e volume naturali. La nostra specialità.' },
    { name: 'Colore', description: 'Colorazioni su misura, dalle nuance naturali ai colori più creativi e luminosi.' },
    { name: 'Balayage & schiariture', description: 'Bionde, balayage e schiariture dal risultato naturale e sfumato, pensate su di te.' },
    { name: 'Piega & styling', description: 'Pieghe, frange e acconciature per ogni giorno e per le occasioni speciali.' },
    { name: 'Trattamenti', description: 'Trattamenti di cura, anti-caduta e ricostruzione con prodotti professionali Vitality’s per capelli sani e forti.' },
    { name: 'Taglio uomo', description: 'Tagli maschili curati e contemporanei, rifiniti nel dettaglio.' },
    { name: 'Taglio bambini', description: 'Tagli per i più piccoli in un ambiente sereno e accogliente.' },
  ] satisfies Service[],

  // — Recensioni (placeholder) —
  reviews: [] satisfies Review[],

  // — Domande frequenti (per SEO: FAQPage) —
  faqs: [
    {
      q: 'Come posso prenotare un appuntamento?',
      a: 'Puoi prenotare scrivendoci su WhatsApp, chiamandoci al telefono oppure inviandoci un messaggio diretto su Instagram. Ti rispondiamo il prima possibile.',
    },
    {
      q: 'Quali servizi offre il salone?',
      a: 'Taglio donna, uomo e bambino, colore, balayage e schiariture, cura e taglio dei capelli ricci, pieghe e styling, oltre a trattamenti professionali di cura e anti-caduta.',
    },
    {
      q: 'Siete specializzati nei capelli ricci?',
      a: 'Sì: la cura del capello riccio e mosso è una delle nostre specialità, con tagli e consigli dedicati per esaltare la definizione e il volume naturali.',
    },
    {
      q: 'Dove si trova il salone Desideri di Felicità?',
      a: 'Il salone si trova in Piazza Torino Bosi 6, a Galliera (BO), in Emilia-Romagna. Trovi mappa e indicazioni nella pagina Contatti.',
    },
    {
      q: 'Che prodotti utilizzate?',
      a: 'Utilizziamo prodotti professionali, tra cui la linea Vitality’s, scelti in base alle esigenze e alla salute dei tuoi capelli.',
    },
  ] satisfies Faq[],

  priceRange: '€€',

  // — SEO —
  seo: {
    defaultTitle: 'Desideri di Felicità · Parrucchiera a Galliera (BO)',
    titleTemplate: '%s · Desideri di Felicità',
    defaultDescription:
      'Parrucchiera a Galliera (BO): taglio donna, uomo e bambino, colore, ' +
      'balayage, cura del riccio e trattamenti. Salone Desideri di Felicità di ' +
      'Jessica Asaro. Prenota su WhatsApp.',
    locale: 'it_IT',
    lang: 'it',
  },

  // — Social —
  social: {
    instagram: 'https://www.instagram.com/desideri.di.felicita/',
    facebook: '',
  },

  // — Dati legali (placeholder) —
  legal: {
    companyName: '',
    vatNumber: '',
  },

  /**
   * STATO DI CONFERMA dei dati sensibili (alimenta JSON-LD, mappa e badge UI).
   * Confermati dall'Instagram ufficiale; restano da confermare orari, GPS, prezzi.
   */
  confirmed: {
    ownerName: true,
    slogan: true,
    phone: true,
    whatsapp: true,
    email: true,
    address: true,
    coordinates: false,
    openingHours: false,
    prices: false,
  },
} as const;

export type Site = typeof site;
