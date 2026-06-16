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

## 2. Identità visiva (dal logo / Instagram ufficiale)

- **Blu polvere/slate** `#4a5d7a` → colore principale (testo logo).
- **Oro/bronzo caldo** `#c2a268` → accento (sottotitolo + decori).
- **Rosa cipria** `#e6c3c6` → colore morbido (fiori acquerello del logo).
- **Crema/bianco** `#f8f5f0` → sfondo.
- **Slate navy scuro** `#1e2733` → sezioni scure d'effetto.
- Logo: serif elegante "Desideri di felicità" blu + "DI JESSICA ASARO HAIR STYLIST"
  oro spaziato + forbici lineari + fiori acquerello blu/rosa + decori oro.
- Font sito: **Fraunces** (display serif, self-hosted) + **Manrope** (testo).
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

I flag in `site.confirmed` per questi dati sono a `true` → entrano nel JSON-LD,
la mappa è attiva, niente badge "da confermare".

## 7. Dati ANCORA da confermare

| Dato | Note |
|------|------|
| Orari di apertura | placeholder (Mar–Ven 9–19, Sab 9–18) → badge "da confermare" |
| Coordinate GPS esatte | mappa usa l'indirizzo; per il pin preciso servono lat/lng |
| Prezzi servizi | mostrati come "su richiesta" |
| Foto reali, logo, immagine OG | da caricare |
| Dati legali (P.IVA), eventuale Facebook | da fornire |

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
