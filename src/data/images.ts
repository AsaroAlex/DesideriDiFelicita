/**
 * CENTRALIZZAZIONE IMMAGINI
 * -------------------------
 * Immagini "vere" del sito in `src/assets/images/...` (ottimizzate da Astro
 * con <Image>/<Picture>). Le immagini Open Graph statiche in `public/images/og/`.
 *
 * NOTA — foto con watermark: alcune foto del set professionale "Monica"
 * (fotografa Chiara Mascellani) sono provini con watermark, in attesa delle
 * versioni pulite. Sono segnalate con `// [WM → swap]`: quando arrivano i file
 * puliti basta sovrascrivere lo stesso file in `src/assets/images/...`.
 */

import type { ImageMetadata } from 'astro';

// Hero
import heroOnde from '../assets/images/hero/hero-onde-balayage-01.jpg'; // [WM → swap]

// Galleria lavori
import ondeLungheCoda from '../assets/images/gallery/onde-lunghe-coda-01.jpg';
import curaRiccio from '../assets/images/gallery/cura-del-riccio-01.jpg';
import risultatoMonica from '../assets/images/gallery/risultato-monica-01.jpg'; // [WM → swap]
import acconciatura from '../assets/images/gallery/acconciatura-raccolto-01.jpg';
import ritrattoMonica from '../assets/images/gallery/ritratto-onde-monica-01.jpg'; // [WM → swap]
import balayageLob from '../assets/images/gallery/balayage-lob-01.jpg';
import pixieRosa from '../assets/images/gallery/colore-creativo-pixie-rosa-01.jpg';
import coloreLungo from '../assets/images/gallery/colore-lungo-riflessi-01.jpg';
import biondoBalayage from '../assets/images/gallery/biondo-balayage-lungo-01.jpg';
import ricciStyling from '../assets/images/gallery/ricci-styling-01.jpg';
import ondeLunghe from '../assets/images/gallery/onde-lunghe-01.jpg';
import taglioUomo from '../assets/images/gallery/taglio-uomo-sfumato-01.jpg';

// Salone (interni)
import salonePostazione from '../assets/images/salon/salone-postazione-01.jpg';
import saloneSpecchi from '../assets/images/salon/salone-specchi-01.jpg';

// Titolare (Jessica)
import jessica01 from '../assets/images/team/team-jessica-01.jpg';
import jessica02 from '../assets/images/team/team-jessica-02.jpg';
import jessicaAtWork from '../assets/images/team/team-jessica-atwork-01.jpg'; // [WM → swap]

export interface GalleryImage {
  src: ImageMetadata;
  alt: string;
  /** Categoria opzionale per filtrare la galleria (es. "Tagli", "Colore") */
  category?: string;
  /** Didascalia breve da mostrare sotto la foto. */
  treatment?: string;
}

/** Immagine principale dell'hero (verticale). */
export const heroImage: ImageMetadata | null = jessica01;

/** Galleria lavori — le prime 6 compaiono in home, tutte nella pagina galleria. */
export const galleryImages: GalleryImage[] = [
  { src: ondeLungheCoda, alt: 'Onde morbide su capelli lunghi raccolti in coda', category: 'Pieghe', treatment: 'Piega onde morbide' },
  { src: curaRiccio, alt: 'Cura del capello riccio: ricci scuri definiti e luminosi', category: 'Ricci', treatment: 'Cura del riccio' },
  { src: risultatoMonica, alt: 'Piega a onde su balayage luminoso, risultato finale', category: 'Pieghe', treatment: 'Onde su balayage' },
  { src: acconciatura, alt: 'Acconciatura raccolta elegante con accessorio gioiello', category: 'Acconciature', treatment: 'Acconciatura raccolta' },
  { src: ritrattoMonica, alt: 'Ritratto con onde morbide e colore naturale', category: 'Pieghe', treatment: 'Piega naturale' },
  { src: balayageLob, alt: 'Balayage su taglio medio ondulato (lob)', category: 'Colore', treatment: 'Balayage luminoso' },
  { src: pixieRosa, alt: 'Colore creativo: taglio pixie rosa', category: 'Colore', treatment: 'Colore creativo' },
  { src: coloreLungo, alt: 'Colore su capelli lunghi con riflessi caldi', category: 'Colore', treatment: 'Riflessi caldi' },
  { src: biondoBalayage, alt: 'Biondo balayage su capelli lunghi mossi', category: 'Colore', treatment: 'Biondo balayage' },
  { src: ricciStyling, alt: 'Styling di ricci definiti in salone', category: 'Ricci', treatment: 'Styling ricci' },
  { src: ondeLunghe, alt: 'Onde su capelli lunghi', category: 'Pieghe', treatment: 'Onde lunghe' },
  { src: taglioUomo, alt: 'Taglio uomo sfumato', category: 'Tagli', treatment: 'Taglio uomo sfumato' },
];

/** Foto degli interni / ambiente del salone. */
export const salonImages: GalleryImage[] = [
  { src: salonePostazione, alt: 'Postazione di lavoro nel salone Desideri di Felicità' },
  { src: saloneSpecchi, alt: 'Specchi e ambiente del salone a Galliera (BO)' },
];

/** Foto della titolare / team. */
export const teamImages: GalleryImage[] = [
  { src: jessica01, alt: 'Jessica Asaro, hair stylist e titolare di Desideri di Felicità' },
  { src: jessica02, alt: 'Jessica Asaro nel suo salone a Galliera' },
  { src: jessicaAtWork, alt: 'Jessica Asaro durante un servizio di colore' },
];

/** Prima/dopo (da popolare in seguito con coppie curate). */
export const beforeAfterImages: GalleryImage[] = [];

/** Immagine Open Graph (condivisioni social). Statica in public/images/og/. */
export const ogImage: string | null = 'images/og/og-default.jpg';
