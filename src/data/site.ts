/**
 * UNICA FONTE DI VERITÀ per tutti i dati del salone.
 * ---------------------------------------------------
 * I componenti devono LEGGERE da qui: non duplicare telefono, indirizzo,
 * social, orari o dati SEO direttamente nei componenti.
 *
 * ⚠️ DATI "DA CONFERMARE": alcuni valori sono solo PROVVISORI (forniti come
 * "possibili"). Finché non sono verificati restano con `confirmed.* = false`:
 *   - il JSON-LD NON li pubblica (gestione sicura);
 *   - la mappa NON mostra un indirizzo inventato;
 *   - nell'interfaccia vengono mostrati con l'etichetta "da confermare".
 * Per pubblicare un dato come definitivo: verificalo e metti il relativo
 * flag in `confirmed` a `true`.
 */

export interface Address {
  /** Via e numero civico */
  street: string;
  city: string;
  /** Sigla provincia, es. "BO" */
  province: string;
  postalCode: string;
  /** Regione, es. "Emilia-Romagna" */
  region: string;
  /** Codice paese ISO, es. "IT" */
  country: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

/** Specifica orari in formato compatibile schema.org */
export interface OpeningHour {
  /** Giorni in inglese (schema.org), es. ["Tuesday","Wednesday"] */
  days: string[];
  /** Etichetta leggibile in italiano per l'interfaccia */
  label: string;
  /** "HH:MM" */
  opens: string;
  /** "HH:MM" */
  closes: string;
}

export interface Service {
  name: string;
  description: string;
  /** Prezzo placeholder, es. "da 25€" — opzionale */
  price?: string;
}

export interface Review {
  author: string;
  text: string;
  /** 1–5 */
  rating?: number;
}

export const site = {
  // — Identità —
  businessName: 'Desideri di Felicità',
  ownerName: 'Jessica Asaro', // da confermare
  category: 'Parrucchiera · Hair stylist · Salone di bellezza',
  slogan: 'La bellezza nasce da un desiderio, la felicità lo rende reale.', // da confermare
  description:
    'Desideri di Felicità è il salone dove ogni taglio, colore e piega nasce ' +
    'dall’ascolto del tuo desiderio. Uno spazio curato e accogliente in cui ' +
    'la cura dei capelli diventa un momento di benessere.',

  // — Contatti (da confermare) —
  phone: '+39 350 012 5159', // da confermare
  whatsapp: '+39 350 012 5159', // da confermare
  email: '', // da fornire

  // — Sede (da confermare) —
  address: {
    street: 'Piazza T. Bosi 6, Galliera Antica',
    city: 'Galliera',
    province: 'BO',
    postalCode: '40015',
    region: 'Emilia-Romagna',
    country: 'IT',
  } satisfies Address,
  coordinates: { lat: 0, lng: 0 } satisfies Coordinates, // da confermare

  // — Orari (placeholder, da confermare) —
  openingHours: [
    { days: ['Tuesday', 'Wednesday', 'Thursday', 'Friday'], label: 'Mar–Ven', opens: '09:00', closes: '19:00' },
    { days: ['Saturday'], label: 'Sabato', opens: '09:00', closes: '18:00' },
  ] satisfies OpeningHour[],

  // — Link ufficiali —
  instagramUrl: 'https://www.instagram.com/desideri.di.felicita/',
  googleBusinessUrl: 'https://share.google/f8pi0yJ5BJtgtEYM0',
  driveAssetsUrl: 'https://drive.google.com/drive/folders/1j-x6ktD0Pwf7lszvTbrecCykGlO8rM0f',

  // — Servizi (placeholder, da rivedere con la titolare) —
  services: [
    { name: 'Taglio donna', description: 'Taglio personalizzato studiato sulla forma del viso e sullo stile di chi lo indossa.', price: 'da confermare' },
    { name: 'Piega & styling', description: 'Pieghe, messe in piega ed acconciature per ogni occasione.', price: 'da confermare' },
    { name: 'Colore', description: 'Colorazioni su misura, dai toni naturali alle nuance più ricercate.', price: 'da confermare' },
    { name: 'Balayage & schiariture', description: 'Schiariture luminose e sfumature naturali studiate su di te.', price: 'da confermare' },
    { name: 'Trattamenti', description: 'Trattamenti di cura e ricostruzione per capelli sani e luminosi.', price: 'da confermare' },
    { name: 'Taglio uomo', description: 'Tagli maschili curati nel dettaglio.', price: 'da confermare' },
  ] satisfies Service[],

  // — Recensioni (placeholder) —
  reviews: [] satisfies Review[],

  priceRange: '€€', // da confermare

  // — SEO —
  seo: {
    defaultTitle: 'Desideri di Felicità · Parrucchiera a Galliera (BO)',
    titleTemplate: '%s · Desideri di Felicità',
    defaultDescription:
      'Desideri di Felicità, salone di parrucchiera a Galliera (BO): taglio, ' +
      'colore, piega e trattamenti su misura. Prenota su WhatsApp.',
    locale: 'it_IT',
    lang: 'it',
  },

  // — Social —
  social: {
    instagram: 'https://www.instagram.com/desideri.di.felicita/',
    facebook: '', // da fornire se esiste
  },

  // — Dati legali (placeholder) —
  legal: {
    companyName: '', // ragione sociale, da fornire
    vatNumber: '', // P.IVA, da fornire
  },

  /**
   * STATO DI CONFERMA dei dati sensibili.
   * Metti a `true` SOLO i dati verificati: alimenta JSON-LD, mappa e badge UI.
   */
  confirmed: {
    ownerName: false,
    slogan: false,
    phone: false,
    whatsapp: false,
    email: false,
    address: false,
    coordinates: false,
    openingHours: false,
    priceRange: false,
    services: false,
  },
} as const;

export type Site = typeof site;
