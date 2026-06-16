# CLAUDE.md — Memoria di progetto

> File di memoria del progetto: viene riletto automaticamente all'inizio di ogni
> sessione. Contiene tutto ciò che serve per lavorare al sito del salone.
> **Aggiornare questo file ogni volta che arrivano nuove informazioni.**

## 1. Panoramica del brand

- **Nome attività:** Desideri di Felicità
- **Tipo:** parrucchiera / hair stylist / salone di bellezza
- **Per chi:** sito creato per l'attività della sorella della persona che ha
  creato il repository.
- **Tono/identità:** elegante, femminile, accogliente, premium ma calda;
  cura, bellezza, fiducia, benessere.
- **Claim (da confermare):** “La bellezza nasce da un desiderio, la felicità lo
  rende reale.”

## 2. Obiettivo del sito

Sito **vetrina** (no e-commerce, no booking) orientato alla **conversione locale**
e alla **SEO locale**. Priorità:
1. Conversione: WhatsApp visibile, click-to-call, indirizzo, orari, mappa, servizi,
   galleria lavori, link Instagram.
2. SEO locale: JSON-LD `HairSalon`, NAP centralizzati, sitemap, robots.txt,
   canonical, Open Graph, pagine indicizzabili, performance alte.
3. Design premium elegante/editoriale, mobile impeccabile.
4. Solo dopo: rifinitura "Awwwards-like" (Fase 2).

## 3. Stack tecnico

- **Astro** (output statico) + **TypeScript** + CSS moderno (custom properties).
- Unica dipendenza non-core: `@astrojs/sitemap`.
- **Niente** GSAP/Lenis/librerie decorative. JavaScript minimo.
- Deploy: **GitHub Pages** via GitHub Actions. Dominio custom in futuro.

## 4. Link ufficiali del progetto

- Google / scheda attività: https://share.google/f8pi0yJ5BJtgtEYM0
- Instagram: https://www.instagram.com/desideri.di.felicita/
- Google Drive (materiali): https://drive.google.com/drive/folders/1j-x6ktD0Pwf7lszvTbrecCykGlO8rM0f

> ⚠️ Questi link, in ambiente Claude, NON sono accessibili automaticamente
> (rispondono 403 / richiedono login). Per usarne i contenuti (foto, logo,
> indirizzo, stile Instagram) i materiali vanno forniti/caricati nel repo.

## 5. Dati confermati

- Nome attività: **Desideri di Felicità**
- Categoria: parrucchiera / salone di bellezza
- Instagram: https://www.instagram.com/desideri.di.felicita/

## 6. Dati DA CONFERMARE (provvisori — non pubblicare come definitivi)

| Dato | Valore provvisorio |
|------|--------------------|
| Titolare | Jessica Asaro |
| Località | Galliera, BO |
| Indirizzo | Piazza T. Bosi 6, Galliera Antica, Galliera (BO) |
| Telefono / WhatsApp | +39 350 012 5159 |
| Claim | “La bellezza nasce da un desiderio, la felicità lo rende reale.” |
| Orari | Mar–Ven 9–19, Sab 9–18 (placeholder) |
| Servizi / prezzi | elenco placeholder in `site.ts` |

Gestione tecnica: in `src/data/site.ts` l'oggetto `confirmed` tiene i flag per
ogni dato sensibile. Finché un flag è `false`:
- il dato **non** entra nel JSON-LD;
- la **mappa** non viene mostrata (placeholder);
- in pagina compare il badge "da confermare".

## 7. Convenzioni tecniche

- **Unica fonte di verità dei dati:** `src/data/site.ts`. I componenti leggono
  da qui: **mai** scrivere telefono/indirizzo/social/orari/SEO direttamente nei
  componenti.
- **Tema/estetica:** `src/styles/tokens.css` (colori, font, spaziature). Cambiare
  il look = cambiare i token.
- **SEO:** componente `Seo.astro` (meta/OG/canonical) + `structured-data.ts`
  (JSON-LD `HairSalon`, omette i dati non confermati). Sitemap via integrazione.
- **Deploy/base path:** `astro.config.mjs` gestisce `site`/`base`. Su Pages di
  progetto `base = "/DesideriDiFelicita"`. I link interni usano `withBase()`
  (`src/lib/href.ts`).
- Accessibilità WCAG AA, HTML semantico, focus visibili, `alt` descrittivi,
  rispetto di `prefers-reduced-motion`.

## 8. Convenzioni immagini

- Immagini ottimizzate: `src/assets/images/{brand,hero,salon,gallery,team,before-after}/`.
- Immagini statiche/OG: `public/images/og/`.
- Collegamento centralizzato in `src/data/images.ts`.
- Nomi file: minuscolo, niente spazi/accenti, trattini, numerazione `01, 02`.
  Es: `hero-salone-01.jpg`, `colore-balayage-01.jpg`, `team-jessica-01.jpg`,
  `logo-desideri-di-felicita.png`.

## 9. Checklist dati/materiali mancanti

- [ ] Nome titolare confermato
- [ ] Indirizzo completo + coordinate (lat/lng)
- [ ] Telefono e numero WhatsApp confermati
- [ ] Orari di apertura reali
- [ ] Elenco servizi + prezzi
- [ ] Email, eventuale Facebook, dati legali (P.IVA)
- [ ] Foto reali (hero, salone, lavori, team, prima/dopo)
- [ ] Logo
- [ ] Palette colori e font del brand (o riferimenti stile Instagram)
- [ ] Immagine OG `public/images/og/og-default.jpg` (1200×630)
- [ ] Dominio personalizzato

## 10. Decisioni già prese

- Sito vetrina, non e-commerce; nessun form né booking in Fase 1.
- Contatto solo WhatsApp + telefono (più mappa/orari/Instagram).
- Stack Astro statico + TS; sola dipendenza extra `@astrojs/sitemap`.
- Niente animazioni pesanti in Fase 1 (no GSAP/Lenis); solo reveal leggero
  via IntersectionObserver, disattivato con `prefers-reduced-motion`.
- Design di partenza elegante/editoriale con token modificabili; allineamento
  allo stile Instagram rimandato alla Fase 2 (link non accessibili da qui).
- Deploy GitHub Pages; dominio custom predisposto ma non ancora impostato
  (nessun `public/CNAME` finché il dominio non è scelto).
