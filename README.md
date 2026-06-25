# Desideri di Felicità

> **«La bellezza nasce da un desiderio, la felicità lo rende reale.»**
> *Creiamo insieme il tuo momento felice.*

Sito **vetrina** del salone di parrucchiera **Desideri di Felicità** di **Jessica Asaro**
a Galliera (BO). Specialità: **cura del capello riccio**, oltre a taglio, colore,
balayage, styling e trattamenti. Nessun e-commerce e nessuna prenotazione online: le
prenotazioni avvengono via **WhatsApp**, telefono o DM Instagram. Obiettivo: **conversione
locale** e **SEO locale**, con un design editoriale premium e mobile-first.

Online su GitHub Pages: <https://asaroalex.github.io/DesideriDiFelicita/>

---

## Stack

- **Astro 5** (output statico) + **TypeScript** (config `astro/tsconfigs/strict`).
- CSS moderno con custom properties (nessun framework CSS).
- Font self-hosted via `@fontsource`: **Fraunces** (display), **Manrope** (testo),
  **Quicksand** (wordmark del logo).
- `@astrojs/sitemap` per `sitemap-index.xml`.
- Motion leggero: View Transitions native (`ClientRouter`), reveal via IntersectionObserver,
  barra di scroll in CSS — tutto gated da `prefers-reduced-motion`.

## Sviluppo

```bash
npm install
npm run dev      # server di sviluppo
npm run build    # build di produzione in dist/
npm run preview  # anteprima della build
npx astro check  # diagnostica TypeScript/Astro
```

## Struttura

```
src/
  data/site.ts          Unica fonte di verità: contatti, indirizzo, orari, servizi,
                        recensioni, FAQ, SEO, social — con l'oggetto `confirmed`.
  data/images.ts        Manifest immagini + alt text.
  lib/                  href.ts (withBase), contact.ts (tel/WhatsApp), structured-data.ts (JSON-LD).
  components/*.astro     Header, Hero, Gallery, ServiceCard, Testimonials, Faq, Footer,
                        WhatsappButton, MapEmbed, Breadcrumbs, Logo, Seo, StructuredData.
  layouts/BaseLayout.astro
  pages/*.astro          index, chi-siamo, servizi, galleria, contatti, 404, robots.txt.ts
  styles/tokens.css      Design token (palette, tipografia, spaziature) — punto unico per il look.
  styles/global.css      Stili base, bottoni, card, accessibilità, reveal.
public/                  favicon, manifest, immagini OG.
docs/                    Materiali di brand e brief (non parte del build).
```

## Convenzioni

- **Dati centralizzati.** Contatti, indirizzo, social, orari e dati SEO si modificano solo
  in `src/data/site.ts`; i componenti leggono da lì, non li duplicano.
- **Confermato vs da confermare.** L'oggetto `site.confirmed` governa cosa entra nel
  JSON-LD e nei badge UI. Owner, slogan, telefono, email, indirizzo e orari sono confermati;
  **prezzi** ("su richiesta") e **coordinate GPS esatte** no, quindi vengono omessi dallo
  schema finché i flag restano `false`. Non allentare questa regola per arricchire lo schema.
- **Palette "Azzurro elettrico & inchiostro".** Azzurro vivido `#2e6be6` (primario/accento),
  azzurro luce `#7cb2ff` (su scuro), inchiostro `#070c18` (sezioni scure/testo), bianco puro
  `#ffffff`. I token sono in `src/styles/tokens.css`.
  > Nota: i nomi token `--color-gold*` / `--color-blush*` sono mantenuti per compatibilità
  > ma valgono toni **azzurri**.
- **Base path.** Su GitHub Pages di progetto il base è `/DesideriDiFelicita`; i link interni
  usano `withBase()` (`src/lib/href.ts`).
- **Accessibilità.** HTML semantico, focus visibili, `alt` descrittivi, reveal con fallback no-JS.

## Deploy

Pubblicazione automatica su **GitHub Pages** tramite GitHub Actions
(`.github/workflows/deploy.yml`) a ogni push su `main` o sul branch di lavoro corrente.
In *Settings → Pages* la sorgente deve essere impostata su **GitHub Actions**.
