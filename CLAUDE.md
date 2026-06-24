# CLAUDE.md — Memoria di progetto

> File di memoria del progetto: riletto automaticamente a inizio sessione.
> **Aggiornarlo ogni volta che arrivano nuove informazioni.**

## 1. Panoramica del brand

- **Nome attività:** Desideri di Felicità
- **Titolare:** Jessica Asaro (Hair Stylist)
- **Tipo:** parrucchiera / hair stylist / salone di bellezza
- **Per chi:** sito creato per l'attività della sorella del proprietario del repo.
- **Tono/identità:** elegante, femminile, romantico, accogliente; cura, bellezza,
  fiducia, benessere. Specialità: **cura del capello riccio**.
- **Slogan:** "La bellezza nasce da un desiderio, la felicità lo rende reale."
- **Tagline:** "Creiamo insieme il tuo momento felice."

## 2. Identità visiva — palette "Azzurro elettrico & inchiostro" (2026-06-24)

> Cambio direzione approvato dall'utente: dismessa la palette calda oro/rosa/crema,
> adottata una palette **azzurro · azzurro-nero · bianco** bold ad alto contrasto
> (riferimenti: salon premiati Awwwards — foto grandi, tanto bianco, monocromia).

- **Azzurro vivido** `#2e6be6` → colore principale + accento (token `--color-primary`/`--color-gold`).
- **Azzurro luce** `#7cb2ff` → accento chiaro / su fondo scuro (`--color-gold-on-dark`).
- **Inchiostro (blu-nero)** `#070c18` → testo forte + sezioni scure full-bleed (`--color-dark`/`--color-ink`).
- **Bianco puro** `#ffffff` → sfondo; **azzurro velato** `#f4f8ff` → superfici alternate.
- WhatsApp: ora **azzurro** (non più verde) — CTA discreta e coerente con la palette.
- Logo: wordmark serif blu (armonizza nativamente con l'azzurro); favicon = tile
  blu-nero + anello azzurro luce + "D" bianca.
- ⚠️ I nomi token `--color-gold*` / `--color-blush*` sono **mantenuti** per
  compatibilità ma ora valgono toni **azzurri** (accento e fondali tenui).
- Font sito: **Fraunces** (display serif, self-hosted) + **Manrope** (testo) — invariati.
- Token in `src/styles/tokens.css` (cambiare lì = cambiare tutto il look).

## 3. Obiettivo del sito

Sito **vetrina** (no e-commerce, no booking) per **conversione locale** + **SEO locale**.
Priorità: 1) conversione (WhatsApp/telefono/indirizzo/orari/mappa/servizi/galleria/IG);
2) SEO locale (JSON-LD HairSalon + FAQPage + BreadcrumbList, sitemap, robots, canonical,
OG, performance); 3) design premium editoriale; 4) rifinitura "Awwwards-like".

## 4. Stack tecnico

- **Astro 5** (statico) + **TypeScript** + CSS moderno (custom properties).
- Dipendenze: `@astrojs/sitemap`, `@fontsource-variable/fraunces`,
  `@fontsource-variable/manrope`. **Niente** GSAP/Lenis.
- Motion leggero: View Transitions native (`ClientRouter`), reveal via
  IntersectionObserver (`astro:page-load`, fallback `html.js`), barra scroll CSS,
  tutto con `prefers-reduced-motion`.
- Deploy: **GitHub Pages** via GitHub Actions (workflow su branch corrente + `main`).

## 5. Link ufficiali

- Instagram: https://www.instagram.com/desideri.di.felicita/ (@desideri.di.felicita)
- Google / scheda attività: https://share.google/f8pi0yJ5BJtgtEYM0
- Google Drive (materiali): https://drive.google.com/drive/folders/1j-x6ktD0Pwf7lszvTbrecCykGlO8rM0f

> ⚠️ In ambiente Claude questi link NON sono accessibili (403/login). I dati sono
> stati ricavati dagli **screenshot dell'Instagram** forniti dall'utente.

## 6. Dati CONFERMATI (da Instagram ufficiale + biglietto da visita)

| Dato | Valore |
|------|--------|
| Titolare | Jessica Asaro |
| Indirizzo | Piazza Torino Bosi 6, Galliera (BO), 40015, Emilia-Romagna |
| Telefono / WhatsApp | +39 350 012 5159 |
| Email | asarojessica92@gmail.com |
| Slogan | "La bellezza nasce da un desiderio, la felicità lo rende reale." |
| Servizi | taglio donna/uomo/bambini, colore, balayage/biondo, cura del riccio, piega/frangia, trattamenti (Vitality's, anti-caduta) |
| Prenotazioni | WhatsApp, telefono, DM Instagram |
| P. IVA | IT04315221202 |
| Orari | Mar/Mer 9–15·17–19, Gio 9–15, Ven 9–13·17–19, Sab 9–13, Dom/Lun chiuso |
| Recensioni Google | 5,0 · 3 recensioni (Monica Malverti, Tatiana Flocea, alice paxia) — in vetrina, non nel JSON-LD |

I flag in `site.confirmed` per questi dati sono a `true` → entrano nel JSON-LD,
la mappa è attiva, niente badge "da confermare".

## 7. Dati ANCORA da confermare

| Dato | Note |
|------|------|
| Coordinate GPS esatte | mappa usa l'indirizzo; per il pin preciso servono lat/lng |
| Prezzi servizi | mostrati come "su richiesta" |
| Foto reali, logo, immagine OG | da caricare |
| Ragione sociale completa, eventuale Facebook | da fornire (P. IVA già fornita: IT04315221202) |

## 8. Convenzioni tecniche

- **Unica fonte di verità dati:** `src/data/site.ts` (con oggetto `confirmed`).
  Mai scrivere contatti/indirizzo/social/orari/SEO nei componenti.
- **Tema:** `src/styles/tokens.css`. **SEO:** `Seo.astro` + `StructuredData.astro`
  + `structured-data.ts` (HairSalon/Breadcrumb/FAQ, omette i dati non confermati).
- **Base path:** `astro.config.mjs` (`site`/`base`). Su Pages di progetto
  `base = "/DesideriDiFelicita"`. Link interni con `withBase()` (`src/lib/href.ts`).
- Accessibilità WCAG AA, HTML semantico, focus visibili, `alt` descrittivi,
  reveal con fallback no-JS.

## 9. Convenzioni immagini

- Ottimizzate: `src/assets/images/{brand,hero,salon,gallery,team,before-after}/`.
- Statiche/OG: `public/images/og/`. Collegamento in `src/data/images.ts`.
- Nomi: minuscolo, no spazi/accenti, trattini, numerazione `01, 02`.
  Es: `hero-salone-01.jpg`, `colore-balayage-01.jpg`, `team-jessica-01.jpg`,
  `logo-desideri-di-felicita.png`, `og-default.jpg` (1200×630).

## 10. Stato & decisioni

- **Fase 1** (base solida): completata e pubblicata.
- **Fase 2** (elevazione Awwwards + SEO): in corso — palette brand, font editoriali,
  hero, sezioni editoriali, sezione scura, FAQ, breadcrumb, view transitions.
- Sito **già online** su GitHub Pages: https://asaroalex.github.io/DesideriDiFelicita/
  (deploy automatico dal branch di lavoro; non esiste ancora `main`).
- Da fare: foto/logo reali, orari, prezzi; valutare dominio personalizzato + email
  professionale (ricerca hosting in corso); eventuale upgrade Astro 6.

## 11. Feedback visuale utente — 2026-06-23

- Il vecchio marchio DF monolinea viene percepito come un numero `5`: per ora usare
  in header un wordmark solo testo, senza monogramma; favicon/emblemi restano ridotti
  a una `D` semplice finché il segno definitivo non viene approvato.
- Il verde WhatsApp puro è troppo aggressivo e dà l'impressione che l'obiettivo sia
  solo spingere la prenotazione: mantenere la CTA riconoscibile ma più discreta.
- La home deve mostrare prima i lavori: galleria subito dopo l'hero, con didascalia
  sotto ogni foto per indicare il trattamento.
- Jessica deve comparire in home con una presentazione fotografica e personale.
- "Cura del riccio" va separata come sezione speciale, non ripetuta sia nei servizi
  sia nei valori.
- Recensioni non in card: meglio centrali, testuali, con stelline e autore.
- Direzione estetica generale: meno box/template, più armonia, più morbidezza e
  reveal dal basso più leggero.

## 12. Svolta grafica — 2026-06-24

- **Palette rifatta**: dismessa oro/rosa/crema → **azzurro elettrico + inchiostro +
  bianco** (vedi sez. 2). Applicata via `tokens.css` + favicon/manifest/theme-color.
- **WhatsApp → azzurro** (token `--color-whatsapp`), su richiesta esplicita.
- **Mosse "bold" (Awwwards-like) implementate in home**:
  1. **Hero** a tutta altezza con foto su **blocco blu-nero** e tipografia gigante.
  2. **Sezione "Cura del riccio"** convertita in **band full-bleed inchiostro** con
     foto che sanguina sul bordo (riusa `section--dark` per i colori).
  3. **Galleria** con didascalia-trattamento + **hover azzurro** (velo + ring).
  4. **Micro-interazioni** sui pulsanti (lift, glow azzurro, focus ring, press).
- Obiettivo dichiarato dall'utente: «il miglior sito al mondo di parrucchieri».
