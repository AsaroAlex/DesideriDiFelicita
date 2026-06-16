# Desideri di Felicità — sito vetrina

Sito vetrina del salone di parrucchiera **Desideri di Felicità** (Galliera, BO).
Costruito con **Astro** (sito statico), TypeScript e CSS moderno. Veloce,
mobile-first, accessibile e ottimizzato per la **SEO locale**.

> **Stato:** Fase 1 — base solida con contenuti **placeholder**. Foto, logo,
> colori definitivi e dati di contatto verificati arrivano nella Fase 2.

---

## Avvio rapido

Serve [Node.js](https://nodejs.org) 18+.

```bash
npm install      # installa le dipendenze
npm run dev      # avvia il sito in locale su http://localhost:4321
npm run build    # genera il sito statico nella cartella dist/
npm run preview  # anteprima locale del sito buildato
```

## Struttura del progetto

```
src/
  data/site.ts        ← TUTTI i dati del salone (nome, contatti, orari, servizi…)
  data/images.ts      ← collegamento delle immagini del sito
  styles/tokens.css   ← colori, tipografia, spaziature (il "tema")
  styles/global.css   ← stili globali
  layouts/            ← BaseLayout (head, SEO, JSON-LD)
  components/          ← Header, Footer, Hero, ServiceCard, Gallery, ...
  pages/               ← home, servizi, galleria, chi-siamo, contatti, 404
  assets/images/       ← foto del sito (ottimizzate da Astro)
public/                ← favicon, manifest, immagini OG/social
```

## ✏️ Dove modificare i dati del salone

Tutti i dati sono in **un solo file**: [`src/data/site.ts`](src/data/site.ts).
Modifica lì nome, telefono, WhatsApp, indirizzo, orari, servizi, ecc.
I componenti leggono automaticamente da questo file.

**Dati provvisori → definitivi:** alcuni valori sono marcati come "da confermare"
tramite l'oggetto `confirmed` in `site.ts`. Quando un dato è verificato, metti il
relativo flag a `true`: solo allora verrà pubblicato nel JSON-LD e mostrato senza
etichetta "da confermare" (e la mappa si attiverà).

## 📷 Come caricare le foto

1. Metti i file immagine nella cartella giusta dentro `src/assets/images/`:
   - `hero/` — foto grande di apertura
   - `salon/` — interni del salone
   - `gallery/` — lavori (tagli, colori, pieghe)
   - `team/` — titolare e team
   - `before-after/` — prima/dopo
   - `brand/` — logo
   - (per l'immagine social di anteprima: `public/images/og/og-default.jpg`, 1200×630)
2. **Nome file:** minuscolo, niente spazi/accenti, trattini, numerazione `01, 02`.
   Esempi: `hero-salone-01.jpg`, `colore-balayage-01.jpg`, `team-jessica-01.jpg`.
3. Collega le immagini in [`src/data/images.ts`](src/data/images.ts) (ci sono già
   gli esempi nei commenti). Ogni cartella ha un `README.md` con le istruzioni.

## 🚀 Deploy (GitHub Pages)

1. Su GitHub → **Settings → Pages → Source: GitHub Actions**.
2. Fai merge/push su `main`: il workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   builda e pubblica automaticamente.
3. URL del sito (Pages di progetto): `https://asaroalex.github.io/DesideriDiFelicita/`.

### Dominio personalizzato (in futuro)

Quando avrai un dominio (es. `desideridifelicita.it`):
1. In [`astro.config.mjs`](astro.config.mjs) metti `USE_CUSTOM_DOMAIN = true` e
   aggiorna `CUSTOM_DOMAIN` con il dominio reale.
2. Crea il file `public/CNAME` contenente **solo** il dominio (es. `desideridifelicita.it`).
3. Configura i DNS del dominio verso GitHub Pages e rifai il deploy.

## ⚠️ Dati ancora da confermare

- Nome titolare (es. Jessica Asaro)
- Indirizzo completo + **coordinate** (lat/lng per la mappa)
- Telefono / numero WhatsApp
- Orari di apertura
- Elenco servizi e **prezzi**
- Email, eventuale pagina Facebook, dati legali (P.IVA)
- Foto reali, logo, palette/colori e font (per allineare il design all'Instagram)

## Fase 2 (prossimi passi)

- Sostituzione dei placeholder con foto/logo/colori reali e font dedicati.
- Allineamento dell'estetica allo stile Instagram del salone.
- Eventuali animazioni "premium" leggere e rifinitura da premio.
- Possibile form contatti o sistema di prenotazione.
