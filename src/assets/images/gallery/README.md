# Immagini · gallery

Foto dei lavori: tagli, colori, pieghe, acconciature.

**Esempi di nome file:**
- `taglio-donna-01.jpg`
- `colore-balayage-01.jpg`
- `piega-01.jpg`

Collega le immagini in `src/data/images.ts` (array `galleryImages`), con `alt` e
`category` opzionale:
```ts
import taglio01 from '../assets/images/gallery/taglio-donna-01.jpg';
export const galleryImages = [
  { src: taglio01, alt: 'Taglio donna scalato', category: 'Tagli' },
];
```
