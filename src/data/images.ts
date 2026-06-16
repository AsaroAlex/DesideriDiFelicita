/**
 * CENTRALIZZAZIONE IMMAGINI
 * -------------------------
 * Le immagini "vere" del sito vanno caricate in `src/assets/images/...`
 * (così Astro le ottimizza con <Image>/<Picture>). Le immagini Open Graph /
 * social / favicon statiche vanno in `public/images/og/`.
 *
 * Per ora NON esistono ancora immagini reali: i campi sono `null` o vuoti.
 * COME COLLEGARLE quando le carichi:
 *
 *   import heroSalone from '../assets/images/hero/hero-salone-01.jpg';
 *   export const heroImage = heroSalone;
 *
 * e per le gallerie:
 *
 *   import taglio01 from '../assets/images/gallery/taglio-donna-01.jpg';
 *   export const galleryImages = [
 *     { src: taglio01, alt: 'Taglio donna', category: 'Tagli' },
 *   ];
 *
 * Convenzione nomi file: minuscolo, niente spazi/accenti, trattini,
 * numerazione 01/02/03. Es: hero-salone-01.jpg, colore-balayage-01.jpg.
 */

import type { ImageMetadata } from 'astro';

export interface GalleryImage {
  src: ImageMetadata;
  alt: string;
  /** Categoria opzionale per filtrare la galleria (es. "Tagli", "Colore") */
  category?: string;
}

/** Immagine principale dell'hero. Esempio: hero-salone-01.jpg */
export const heroImage: ImageMetadata | null = null;

/** Foto degli interni / ambiente del salone. */
export const salonImages: GalleryImage[] = [];

/** Galleria lavori (tagli, colori, pieghe...). */
export const galleryImages: GalleryImage[] = [];

/** Foto del team / titolare. */
export const teamImages: GalleryImage[] = [];

/** Prima/dopo. */
export const beforeAfterImages: GalleryImage[] = [];

/**
 * Immagine Open Graph (condivisioni social). Statica in public/images/og/.
 * Quando la carichi (consigliato 1200×630), metti il percorso, es:
 *   export const ogImage = 'images/og/og-default.jpg';
 * Resta `null` finché non esiste, così non generiamo meta tag rotti.
 */
export const ogImage: string | null = null;
