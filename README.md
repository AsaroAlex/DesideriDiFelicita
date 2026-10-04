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
- Font self-hosted via `@fontsource`: **Fraunces** (display), **Manrope** (testo).
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
  pages/*.astro          index, chi-siamo, servizi, galleria, contatti, privacy, 404, robots.txt.ts
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
  usano `withBase()` (`src/lib/href.ts`). Con `SITE_URL` o `RAILWAY_PUBLIC_DOMAIN`
  il base predefinito è `/`; `BASE_PATH` consente un prefisso esplicito.
- **Accessibilità.** HTML semantico, focus visibili, `alt` descrittivi, reveal con fallback no-JS.

## Immagini e servizi esterni

Le foto selezionate dalla cartella Drive sono registrate in `docs/foto-drive.json`,
con file di origine e asset del sito. I JPEG (compresi gli HEIC convertiti) vengono
ottimizzati da Astro in varianti responsive; i provini con watermark restano esclusi
dalle pagine. La selezione in home usa il flag `featured` nel manifest immagini.

La mappa Google viene caricata solo dopo il clic su «Carica la mappa»; il collegamento
alle indicazioni resta disponibile anche senza JavaScript. La pagina `/privacy`
descrive navigazione, hosting e collegamenti esterni. Non vengono salvate preferenze
per la mappa nel browser.

## Deploy

### Railway

URL pubblico: <https://desideri-di-felicita-production.up.railway.app/>

Il ramo dedicato è `codex/railway-deploy`. Collegare il repository al servizio
Railway e selezionare questo ramo, oppure pubblicare il checkout con `railway up`.
`railway.json` definisce build con Railpack, avvio tramite `npm start` e healthcheck `/`.
Il sito viene compilato una volta e servito come file statici da `dist/`.
`serve.json` disabilita gli elenchi delle cartelle e distingue la cache degli asset
con hash (`/_astro/`, un anno) dalla rivalidazione delle pagine e degli altri file.

```bash
npm ci
npm run build
PORT=3000 npm start
```

Il server ascolta su `0.0.0.0` usando `PORT`, assegnata da Railway; in locale il
valore predefinito è `3000`. Generare un dominio pubblico nella sezione Networking
del servizio prima della build definitiva: `RAILWAY_PUBLIC_DOMAIN` imposta
automaticamente l’origine HTTPS del sito e `base: '/'`.

Per scegliere esplicitamente l’origine, impostare `SITE_URL` nelle variabili
Railway, per esempio `https://nome-servizio.up.railway.app`. Deve contenere solo
un’origine HTTP/HTTPS, senza percorso, query o frammento. `SITE_URL` ha precedenza
su `RAILWAY_PUBLIC_DOMAIN`; `BASE_PATH` può specificare un prefisso diverso da `/`.
Queste variabili vengono lette al build: dopo una modifica occorre ricostruire
il sito per aggiornare link, canonical, sitemap, robots e dati strutturati.

Per un futuro dominio personalizzato, aggiungerlo in Networking, configurare i
record DNS indicati da Railway e impostare `SITE_URL=https://dominio-reale` prima
del nuovo deploy. Non è necessario `public/CNAME` su Railway.

### GitHub Pages

Senza `SITE_URL`, `RAILWAY_PUBLIC_DOMAIN` e `BASE_PATH`, la configurazione mantiene
`https://asaroalex.github.io/DesideriDiFelicita/`. Il workflow
`.github/workflows/deploy.yml` pubblica su **GitHub Pages** a ogni push su `main`
o con avvio manuale. In *Settings → Pages* la sorgente deve essere impostata su
**GitHub Actions**.
