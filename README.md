# Desideri di Felicità

> **«La bellezza nasce da un desiderio, la felicità lo rende reale.»**
> *Creiamo insieme il tuo momento felice.*

Sito del salone di parrucchiera **Desideri di Felicità** di **Jessica Asaro**
a Galliera (BO). Specialità: **cura del capello riccio**, oltre a taglio, colore,
balayage, styling e trattamenti. Include **calendario di prenotazione**, **agenda
privata**, schede clienti e collegamenti personali per gestire gli appuntamenti,
oltre al motore proprietario per i **promemoria WhatsApp**, senza un gestionale
SaaS. Design editoriale e mobile-first; nessun e-commerce.

Online su Railway: <https://desideri-di-felicita-production.up.railway.app/>

---

## Stack

- **Astro 5** (output statico) + **TypeScript** (config `astro/tsconfigs/strict`).
- CSS moderno con custom properties (nessun framework CSS).
- Font self-hosted via `@fontsource`: **Fraunces** (display), **Manrope** (testo).
- `@astrojs/sitemap` per `sitemap-index.xml`.
- **Node 24**, HTTP nativo, `node:sqlite` e `serve-handler` per sito e API nello
  stesso servizio. Solo 13 dipendenze runtime; Astro e font servono al build.
- Motion leggero: View Transitions native (`ClientRouter`), reveal via IntersectionObserver,
  barra di scroll in CSS — tutto gated da `prefers-reduced-motion`.

## Sviluppo

```bash
npm ci
npm run dev      # anteprima grafica Astro; non avvia le API
npm test         # prove store, orari, autenticazione e invii Meta simulati
SITE_URL=http://127.0.0.1:3000 BASE_PATH=/ npm run build
npm start        # sito e API; database locale privato .data/
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
  layouts/               BaseLayout, AdminLayout e CustomerLayout.
  pages/*.astro          Vetrina, prenota, appuntamento, admin/agenda, privacy e robots.
  styles/tokens.css      Design token (palette, tipografia, spaziature) — punto unico per il look.
  styles/global.css      Stili base, bottoni, card, accessibilità, reveal.
server/                  API, autenticazione, SQLite, scheduler e adapter Meta.
tests/                   Test con database temporanei e provider simulato.
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

La galleria ha filtri e foto ingrandibili con navigazione da tastiera. Le schede
dei servizi leggono il catalogo pubblicato dall’agenda: descrizioni, prezzi e
durate sono configurabili; i valori mancanti restano su richiesta. Il collegamento
dalla scheda apre la prenotazione con il servizio già selezionato.

La mappa Google si carica automaticamente dopo il consenso nel banner «Cookie e
mappa». La scelta dura al massimo 180 giorni e si può cambiare da «Preferenze
cookie» nel footer; prima del consenso non partono richieste Google. Indirizzo e
indicazioni restano disponibili anche dopo il rifiuto o senza JavaScript.

## Deploy

### Railway

URL pubblico: <https://desideri-di-felicita-production.up.railway.app/>

Il ramo dedicato è `codex/railway-deploy`. Collegare il repository al servizio
Railway e selezionare questo ramo, oppure pubblicare il checkout con `railway up`.
`railway.json` definisce build con Railpack, avvio tramite `npm start` e healthcheck `/api/health`.
Il sito viene compilato una volta e servito da `dist/` insieme alle API Node.
`serve.json` disabilita gli elenchi delle cartelle e distingue la cache degli asset
con hash (`/_astro/`, un anno) dalla rivalidazione delle pagine e degli altri file.

```bash
npm ci
SITE_URL=http://127.0.0.1:3000 BASE_PATH=/ npm run build
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

L’agenda richiede **un volume persistente montato in `/data`**, **una replica** e
le variabili `NODE_ENV=production`, `DATA_DIR=/data`, `APP_ORIGIN` uguale all’origine
HTTPS pubblica. Healthcheck: `/api/health`. Tenere il servizio sempre attivo per
eseguire i promemoria; lo sleep sospenderebbe il timer. Il build rimuove le
dipendenze di sviluppo con `npm prune --omit=dev` dopo aver generato il sito.
I flag `--include=prod --production=true` neutralizzano le impostazioni di
installazione del builder Railway, che altrimenti manterrebbero le librerie di build.

Per attivazione iniziale, configurazione Meta, limiti di costo, backup e recupero,
leggere [la guida dell’agenda](docs/agenda-proprietaria.md). Le durate dei servizi
devono essere impostate da Jessica per la conferma immediata. Il calendario
riceve già richieste con giorno e orario desiderati senza inventare durate.
La stessa guida descrive pause, tempi di preparazione, note private, riprenotazione
e collegamenti personali con scadenza e revoca. Il confronto funzionale con Fresha,
Treatwell, Booksy e Phorest è in [ottimizzazioni competitor](docs/ottimizzazioni-competitor.md).

### GitHub Pages

Senza `SITE_URL`, `RAILWAY_PUBLIC_DOMAIN` e `BASE_PATH`, la configurazione mantiene
`https://asaroalex.github.io/DesideriDiFelicita/`. Il workflow
`.github/workflows/deploy.yml` pubblica su **GitHub Pages** a ogni push su `main`
o con avvio manuale. In *Settings → Pages* la sorgente deve essere impostata su
**GitHub Actions**.
Questa versione resta una vetrina statica con contatto WhatsApp: le API e l’agenda
persistente funzionano nel servizio Railway, non su GitHub Pages.
