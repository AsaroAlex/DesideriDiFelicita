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

Sito del salone con **prenotazioni e agenda proprietarie** (no e-commerce) per **conversione locale** + **SEO locale**.
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
  È disponibile anche il deploy **Railway** dal ramo `codex/railway-deploy`, con
  build statico e server di produzione (`npm start`, `0.0.0.0:$PORT`).

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
| Prenotazioni | Calendario proprietario su Railway, WhatsApp, telefono, DM Instagram |
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
| Logo definitivo | da fornire; foto reali e OG già presenti |
| Ragione sociale completa, eventuale Facebook | da fornire (P. IVA già fornita: IT04315221202) |

## 8. Convenzioni tecniche

- **Unica fonte di verità dati:** `src/data/site.ts` (con oggetto `confirmed`).
  Mai scrivere contatti/indirizzo/social/orari/SEO nei componenti.
- **Tema:** `src/styles/tokens.css`. **SEO:** `Seo.astro` + `StructuredData.astro`
  + `structured-data.ts` (HairSalon/Breadcrumb/FAQ, omette i dati non confermati).
- **Base path:** `astro.config.mjs` (`site`/`base`). Su Pages di progetto
  `base = "/DesideriDiFelicita"`. Con `SITE_URL` o `RAILWAY_PUBLIC_DOMAIN`,
  `base = "/"`; `SITE_URL` prevale sul dominio Railway e deve essere un’origine
  assoluta HTTP/HTTPS. `BASE_PATH` consente un prefisso esplicito. Le variabili
  vengono lette al build. Link interni con `withBase()` (`src/lib/href.ts`).
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
  (workflow ora configurato su `main`; Railway segue `codex/railway-deploy`).
- Da fare: logo definitivo, prezzi; valutare dominio personalizzato + email
  professionale (ricerca hosting in corso); eventuale migrazione a una nuova major Astro.

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

## 13. Pubblicazione Railway — 2026-10-04

- L'utente ha richiesto la pubblicazione del sito su **Railway**.
- Progetto: `DesideriDiFelicita`; servizio: `desideri-di-felicita`; ambiente:
  `production`; regione europea `europe-west4-drams3a`.
- URL pubblico: https://desideri-di-felicita-production.up.railway.app/
- Ramo dedicato: `codex/railway-deploy`; il workflow GitHub Pages rimane su `main`.
- Installazione riproducibile: `npm ci`; build: `npm run build`; output: `dist/`.
- `railway.json` usa Railpack, avvio `npm start` e healthcheck `/`. Il server
  statico di produzione ascolta su `0.0.0.0` alla porta `PORT` assegnata da Railway
  (predefinita `3000` in locale).
- `astro.config.mjs` mantiene il default GitHub Pages, ma su Railway usa
  `RAILWAY_PUBLIC_DOMAIN` come origine HTTPS e `/` come base. Impostare `SITE_URL`
  per scegliere un'origine diversa; `BASE_PATH` può scegliere un prefisso.
- Generare il dominio pubblico prima della build definitiva. Modifiche al dominio
  richiedono un nuovo build per aggiornare canonical, sitemap, robots e JSON-LD.
- Il futuro dominio personalizzato va aggiunto a Railway Networking e collegato
  tramite i record DNS indicati; impostare `SITE_URL` con il dominio reale e
  ripubblicare. Railway non richiede un file `public/CNAME`.

## 14. Migliorie dopo la review — 2026-10-04

- L’utente ha autorizzato correzioni e scelta/integrazione delle foto dalla cartella
  Google Drive ufficiale. Il connettore Drive consente ora la lettura dei materiali.
- Nuovi lavori selezionati per qualità, varietà e sfondi puliti; provenienza
  registrata in `docs/foto-drive.json`. HEIC convertiti in JPEG e resi responsive
  da Astro. Esclusi ospiti dell’inaugurazione, immagini personali e provini con watermark.
- Home mobile più compatta, slogan conservato e un lavoro selezionato già nella foto
  di apertura. Jessica resta nella presentazione personale della home.
  Selezione home esplicita con `featured`, senza dipendere dagli indici del manifest.
- Menu mobile con fallback senza JS; inizializzazione indipendente dal ClientRouter,
  chiusura quando il focus esce, Escape ritorna al pulsante, scroll su schermi bassi.
- Focus FAQ interno e visibile; titoli gerarchici nelle pagine Servizi/Contatti.
  La fascia di prezzo JSON-LD viene omessa finché i prezzi non sono confermati.
- Chi siamo usa contenuti specifici su Jessica, servizi e salone, senza inventare
  qualifiche o anni di attività.
- Google Maps viene caricato soltanto su scelta, con indicazioni disponibili senza JS.
  Nuova pagina `privacy`: descrive il funzionamento effettivo e i servizi esterni.
- Eliminato Quicksand inutilizzato; cache lunga solo per asset Astro con hash,
  pagine rivalidate e directory listing disabilitato tramite `serve.json`.
- Dipendenze mantenute su Astro 5.18.2 con aggiornamenti compatibili. L’audit npm
  residuo segnala Astro, sharp ed esbuild; `npm start` usa solo il server statico
  `serve`, non il runtime Astro. Per azzerare tutte le segnalazioni npm propone una
  migrazione alla major 7, da verificare come manutenzione separata.


## 15. Agenda proprietaria — 2026-10-04

- L’utente ha scelto software proprietario e promemoria **WhatsApp automatici**,
  scartando gestionali SaaS. Non riproporre servizi esterni a pagamento come soluzione.
- `/prenota`: servizi/orari realmente disponibili, conferma atomica con riferimento,
  nome/telefono e consenso WhatsApp facoltativo, nessun account cliente.
- `/agenda`: accesso privato Jessica, attivazione iniziale con token monouso e scadenza,
  password scrypt, sessione 12h, CSRF, calendario giorno/settimana, CRUD appuntamenti,
  durate servizi, orari/chiusure e limiti di invio. Noindex, no-store, no localStorage.
- **Non inventare durate:** inizialmente i servizi sono disabilitati e senza durata.
  Jessica imposta i tempi reali e abilita il calendario dalla sua area.
- Server Node **24**, `node:sqlite`, API Node HTTP e `serve-handler` per `dist/`.
  Astro/font/sitemap sono dipendenze di build; il deploy le rimuove dal runtime.
- SQLite privato su volume Railway `/data`, **una sola replica**, healthcheck
  `/api/health`, `NODE_ENV=production`, `DATA_DIR=/data`, `APP_ORIGIN` HTTPS.
  Il volume deve esistere prima del deploy; non usare storage effimero per l’agenda.
- Backup giornalieri privati con 7 copie, CSV riservato. Gli snapshot sullo stesso
  volume non sostituiscono una copia esterna/backup volume Railway.
- Promemoria default 18:00 Europe/Rome del giorno prima: una sola coda persistente,
  nessun messaggio di conferma a pagamento, quote default 20/giorno e 200/mese.
  Solo 429 esplicito può essere riprovato(max 3), errori ambigui/5xx/timeout richiedono
  verifica; nessun reinvio automatico dopo riavvio o recupero dopo mezzanotte.
- Meta Cloud API ufficiale, versione Graph v26.0, template **utility approvato**
  con 3 parametri nome/data/ora. Nessuna automazione WhatsApp Web.
  Codice pronto non significa invio attivo: servono account/numero/credenziali/template
  Meta. Non promettere che il numero già nell’app funzioni senza migrazione/coexistence.
- Costi: infrastruttura Railway + messaggi Meta secondo tariffa applicabile;
  nessun canone del gestionale. Non presentare come gratis né inventare tariffe Italia.
- Segreti solo variabili server; mai versionare token/password/link di attivazione.
  Test WhatsApp solo con provider simulato; non inviare a clienti durante le verifiche.
- Pages mantiene vetrina/fallback WhatsApp, **non ospita** agenda e API persistenti.
- Dati operativi dell’agenda (durate, orari, chiusure) stanno nel DB e sono modificabili
  dalla titolare; identità/contatti del brand rimangono centralizzati in `site.ts`.
- Privacy aggiornata per modulo prenotazioni, agenda privata/cookie tecnico,
  hosting e consenso facoltativo ai promemoria, senza marketing o analytics.


## 16. Correzione del percorso clienti — 2026-10-04

- L’utente ha segnalato che il calendario era nascosto quando le durate non erano
  configurate e «Prenota» duplicava WhatsApp. Il prodotto deve essere usabile dalle
  clienti al primo accesso, senza richiedere configurazioni tecniche al visitatore.
- Il calendario parte con **richieste attive**, catalogo reale completo, giorni e
  orari desiderati dalle aperture/chiusure effettive. Nessuna durata viene inventata.
  Le richieste sono persistite in `booking_requests` e visibili nell’agenda privata.
- «Richiesta ricevuta» non significa appuntamento confermato. Jessica conferma con
  durata reale, data/ora e controllo atomico dell’intero intervallo; solo allora
  parte la coda promemoria. Conferma e retry sono idempotenti.
- I servizi già configurati possono usare la conferma immediata nello stesso
  calendario. `requestEnabled=true` è indipendente da `bookingEnabled=false`.
  Disabilitare le richieste non disabilita gli slot già configurati, e viceversa.
- Un unico scopo per CTA: Prenota porta al calendario; WhatsApp è consulenza
  contestuale, con testo naturale e senza pulsanti duplicati/flottanti.
- **Mappa richiesta subito dall’utente:** banner Cookie e mappa con consenso o
  Solo necessari, stesso rilievo; nessuna richiesta Google prima della scelta,
  caricamento automatico dopo consenso e alle visite successive. Scelta 180 giorni
  in localStorage tecnico, nessuna PII; revoca da Preferenze cookie nel footer.
- Mappa prima dei dettagli contatto nella pagina Contatti, anche su mobile.
- L’utente ha autorizzato esplicitamente questo popup cookie. Non ripristinare il
  vecchio pulsante «Carica la mappa» come passaggio aggiuntivo dopo il consenso.


## 17. Portale amministratore — 2026-10-04

- L’utente vuole che Jessica configuri e gestisca il salone autonomamente dal portale.
- `/admin` è l’accesso principale; `/agenda` resta un alias compatibile. Layout privato,
  noindex/no-store, senza navigazione promozionale o banner Google/cookie.
- Panoramica con riepilogo, guida alla configurazione e azioni; servizi creabili,
  rinominabili e nascondibili con `listed` indipendente dalla conferma `enabled`.
- Orari modificabili con timepicker e chiusure con datepicker; sincronizzati sui
  contenuti pubblici tramite API, con dati statici confermati come fallback.
- Rubrica da dati già raccolti, ricerca per nome/numero, storico e nuovo appuntamento.
- Collegamento WhatsApp dal portale: credenziali cifrate AES-256-GCM in SQLite,
  chiave `WHATSAPP_CONFIG_KEY` solo sul server. Mai restituire credenziali nei GET.
- Salvataggio e attivazione degli invii sono azioni distinte, protette dalla password.
  Le impostazioni sono dinamiche e persistenti; chiave errata/mancante sospende gli invii.
- Cambio email/password revoca gli altri accessi. Backup SQLite scaricabile solo
  da sessione autenticata con nuova verifica password, Origin e CSRF.
- Non creare credenziali/password per Jessica né attivare l’account al posto suo.
  Il link monouso privato è nel file locale ignorato `.agenda-attivazione.md`.


## 18. Priorità ai costi — 2026-10-05

- L’utente non sa se Jessica abbia WhatsApp Business Platform e autorizza a spendere
  il meno possibile. La preferenza per i promemoria automatici resta valida.
- Collegamento diretto Meta, nessun gestionale o provider aggiuntivo a canone.
  Gli invii restano sospesi finché numero, credenziali e modello non sono configurati.
- Modalità risparmio attiva di default: tetto effettivo 10 al giorno e 60 al mese,
  conservando le quote scelte da Jessica. Un limite 0 continua a sospendere gli invii.
  I limiti contengono i messaggi: non dichiarare un tetto di spesa in euro non verificato.
- Deduplicazione per appuntamento anche fra revisioni dopo invio accettato o incerto.
  Se spostato dopo l’invio, Jessica comunica il nuovo orario manualmente. I record
  relativi a vecchie revisioni non attestano l’invio automatico del nuovo orario.
- Promemoria di oggi, domani e storico; conferma esplicita degli invii manuali.
  Aprire wa.me non significa inviare. La dichiarazione della titolare blocca la
  ricoda automatica senza liberare la quota consumata da un precedente esito incerto.
- Contatori prudenti allineati: gli esiti incerti consumano quota, ma non equivalgono
  a una consegna o a una fattura Meta. Niente presunzione di gratuità entro 24 ore.
- Ricerca del 5 ottobre 2026: la documentazione Meta pricing/non-template-messages
  indica cambi dal 1 ottobre per utility nella finestra 24 ore; usare le regole
  ufficiali applicabili al conto, senza inventare la tariffa italiana.
- Railway misurato su 12 ore: CPU media 0.0000215 vCPU, RAM media 0.0889 GB,
  picco 0.1168 GB. Un solo servizio con volume; non attivare sleep che fermerebbe
  i timer, né confondere il limite RAM con il consumo fatturato. Il piano Hobby
  prevede un minimo di $5 con $5 di consumi inclusi; piano e fattura effettivi del
  conto non verificati. Ottimizzare l’idle senza promettere riduzioni del minimo.

## 19. Ottimizzazione funzionale — 2026-10-05

- L’utente chiede di ottimizzare tutte le funzioni ispirandosi ai migliori concorrenti.
  Benchmark ufficiale Exa su Fresha, Treatwell, Booksy e Phorest: 20 risultati in
  quattro filoni e 12 pattern; fonti e scelte in `docs/ottimizzazioni-competitor.md`.
  Replicare i comportamenti utili, mantenendo brand, testi e foto del salone.
- Nessun nuovo SaaS o servizio operativo, nessuna dipendenza runtime aggiuntiva.
  Conservare limiti WhatsApp, consenso e deduplicazione fra revisioni.
- Catalogo operativo con descrizione, prezzo facoltativo in centesimi, prezzo “da”
  e buffer dopo il servizio; prezzi e durate restano ignoti finché Jessica li salva.
  `RuntimeServiceCatalog` aggiorna vetrina e home dal catalogo pubblico; il contenuto
  statico confermato resta il fallback su Pages o se l’API non risponde.
- Preavviso di prenotazione e modifiche cliente partono da 0, buffer da 0; nessuna
  restrizione commerciale viene inventata. Pause/blocchi sono intervalli privati
  non prenotabili, distinti dagli appuntamenti e verificati anche dal server.
- Agenda con tempi occupati, ricerca nel periodo, azioni rapide ed esiti espliciti.
  Completato/assente sono separati da confermato/annullato e non vengono dedotti
  dal passare del tempo. Appuntamenti con servizio nascosto conservano il collegamento.
- Note cliente nel modulo facoltative; note CRM private con versione per evitare
  sovrascritture concorrenti. Riprenota dallo storico precompila servizio e durata,
  ma richiede nuova data e nuova verifica del consenso al promemoria.
- `/appuntamento` è una pagina cliente riservata senza account, noindex/no-store,
  senza mappa, banner Google o sitemap. Collegamento personale nel frammento URL,
  subito rimosso e conservato solo in RAM; API con Bearer, mai token in query/log.
  Accesso derivato con HKDF/HMAC separato dalla chiave server `WHATSAPP_CONFIG_KEY`,
  hash e nonce nel DB; richiesta confermata conserva il suo collegamento. In assenza
  della chiave server i flussi precedenti continuano senza collegamento personale.
- Spostamenti cliente mantengono durata e buffer originari, controllano gli
  intervalli reali e la revisione. Annullamento/ritiro non liberano quota incerta.
  Un cambio di telefono della cliente revoca i vecchi link e impedisce al vecchio
  UUID pubblico di ottenere il link della nuova destinataria, anche dopo rotazione.
  ICS soltanto confermati e ancora programmati, orari UTC reali, senza dati cliente, token o note;
  il download non sincronizza automaticamente le modifiche nei calendari esterni.
- Galleria filtrabile con lightbox e tastiera; nessuna nuova foto o risorsa remota.
  Calendario con ricerca aggregata di massimo 14 giorni, servizio preselezionato,
  riepilogo e distinzione chiara richiesta/conferma. Retry della conferma immediata
  usa l’UUID di invio per evitare doppi appuntamenti.
