# Desideri di Felicità

> **«La bellezza nasce da un desiderio, la felicità lo rende reale.»**
> *Creiamo insieme il tuo momento felice.*

Sito del salone di parrucchiera **Desideri di Felicità** di **Jessica Asaro** a Galliera (BO),
con **prenotazioni online** e **agenda privata** per il salone. Specialità: cura del capello riccio.

| | |
|---|---|
| Sito per le clienti | <https://desideri-di-felicita-production.up.railway.app/> |
| Area privata di Jessica | <https://desideri-di-felicita-production.up.railway.app/admin> |
| Guida per Jessica (senza termini tecnici) | [docs/guida-jessica.md](docs/guida-jessica.md) |
| Dettagli tecnici dell'agenda | [docs/agenda-proprietaria.md](docs/agenda-proprietaria.md) |

Il vecchio indirizzo `https://asaroalex.github.io/DesideriDiFelicita/` reindirizza al sito ufficiale.

---

## Cosa fa

- **Clienti:** scelgono servizio, giorno e orario. I servizi senza durata impostata inviano una
  **richiesta** che Jessica conferma; quelli con durata e conferma automatica vengono
  **prenotati subito** negli orari liberi. Nessun account: la ricevuta contiene un link
  personale per controllare, spostare o annullare. WhatsApp e telefono restano sempre disponibili.
- **Jessica:** richieste, agenda giorno/settimana, pause, clienti con note private, servizi e
  prezzi, orari e chiusure, promemoria WhatsApp (a mano con un tocco o automatici), esportazione
  per Excel e backup. Funziona dal telefono e si può aggiungere alla schermata Home come un'app.
- **Vetrina:** galleria, servizi, chi siamo, contatti con mappa (dopo il consenso), FAQ,
  SEO locale (JSON-LD HairSalon/FAQ/Breadcrumb, sitemap, canonical, Open Graph).

## Come è fatto

- **Astro 5** genera le pagine statiche (`src/`), **Node 24** le serve insieme alle API (`server/`).
- **SQLite** integrato in Node (`node:sqlite`) su un volume persistente: nessun database esterno,
  nessun servizio a canone. Unica dipendenza di runtime: `serve-handler`.
- Sicurezza: password scrypt, sessioni con cookie HttpOnly/SameSite=Strict, CSRF e controllo
  dell'origine, limiti di frequenza, intestazioni di sicurezza, area privata `noindex`/`no-store`.

## Sviluppo in locale

Serve **Node 24**.

```bash
npm ci
cp .env.example .env        # poi compila WHATSAPP_CONFIG_KEY (comando nel file)
npm run build               # sito in dist/
npm start                   # sito + API su http://127.0.0.1:3000 (dati in .data/)
npm run link-accesso -- http://127.0.0.1:3000   # link per attivare l'area privata in locale
```

Per il link in locale copia `ADMIN_BOOTSTRAP_TOKEN` e `ADMIN_BOOTSTRAP_EXPIRES_AT` stampati dal
comando nel file `.env` e riavvia `npm start`.

| Comando | A cosa serve |
|---|---|
| `npm test` | 135+ test con database temporanei; nessun messaggio reale inviato |
| `npm run check` | Controllo di TypeScript e dei componenti Astro |
| `npm run dev` | Anteprima grafica rapida (senza API) |
| `npm run link-accesso` | Link privato per Jessica: prima attivazione o password dimenticata |

## Pubblicazione

Un solo branch: **`main`**. Ogni push su `main`:

1. **Railway** (progetto `DesideriDiFelicita`, servizio `desideri-di-felicita`) ricostruisce e
   pubblica il sito ufficiale (`railway.json`: build, avvio `node server/index.mjs`,
   healthcheck `/api/health`).
2. **Controlli** (`.github/workflows/ci.yml`) esegue test, controllo dei tipi e build.
3. **GitHub Pages** (`.github/workflows/deploy.yml`) aggiorna i reindirizzamenti del vecchio indirizzo.

Requisiti Railway (già configurati): **una replica**, volume persistente montato in **`/data`**,
servizio sempre attivo (niente sleep: i promemoria hanno bisogno del timer) e queste variabili:

| Variabile | Valore |
|---|---|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/data` |
| `APP_ORIGIN`, `SITE_URL` | origine pubblica HTTPS, es. `https://desideri-di-felicita-production.up.railway.app` |
| `BASE_PATH` | `/` |
| `WHATSAPP_CONFIG_KEY` | chiave privata di 32 byte (base64): **conservarne una copia**, serve anche per i ripristini |
| `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_BOOTSTRAP_EXPIRES_AT` | link di accesso, generati con `npm run link-accesso` |

### Operazioni frequenti

- **Jessica ha dimenticato la password** → `npm run link-accesso`, imposta su Railway le due
  variabili stampate, attendi il riavvio e manda a Jessica il link. Vale una volta sola e scade.
  (Dopo il primo deploy di questa versione il link configurato in precedenza viene considerato
  già usato: genera il nuovo link *dopo* quel deploy.)
- **Dominio personalizzato** → aggiungilo in Railway → Networking, configura i DNS indicati,
  imposta `SITE_URL` e `APP_ORIGIN` con il nuovo indirizzo e ripubblica; aggiorna anche
  `PRODUCTION_URL` in `.github/workflows/deploy.yml` e in `astro.config.mjs`.
- **Backup** → automatico ogni giorno in `/data/backups/` (ultime 7 copie). Jessica può
  scaricare una copia completa dall'area privata. Ripristino e WhatsApp automatico:
  [docs/agenda-proprietaria.md](docs/agenda-proprietaria.md).

## Struttura

```
src/data/site.ts         Unica fonte di verità: contatti, indirizzo, orari di partenza, servizi,
                         recensioni, FAQ, SEO, social, con l'oggetto `confirmed`.
src/data/images.ts       Foto e testi alternativi.
src/components/          Vetrina (Hero, Gallery, …), prenotazione (BookingCalendar),
                         pagina cliente (CustomerAppointment), portale (AgendaApp, …).
src/pages/               Pagine pubbliche, /prenota, /appuntamento, /admin (e alias /agenda), /privacy.
src/styles/tokens.css    Palette e tipografia: il punto unico per il look.
server/                  API HTTP, autenticazione, SQLite, promemoria, link clienti, backup.
tests/                   Test automatici (node --test).
scripts/                 link-accesso.mjs, pages-redirect.mjs.
public/                  Icone, manifest, immagini Open Graph.
docs/                    Guide, materiali di brand e brief (non pubblicati).
```

## Convenzioni

- **Dati del salone solo in `src/data/site.ts`**; i dati operativi (servizi, prezzi, durate,
  orari, chiusure) li gestisce Jessica dall'area privata e stanno nel database.
- **Confermato vs da confermare:** `site.confirmed` decide cosa entra nei dati strutturati.
  Prezzi e coordinate GPS non confermati non vengono pubblicati come certi.
- **Palette «Azzurro elettrico & inchiostro»** in `src/styles/tokens.css`
  (i nomi `--color-gold*`/`--color-blush*` sono storici ma valgono toni azzurri).
- **Accessibilità** WCAG AA: HTML semantico, focus visibili, testi alternativi, controlli
  automatici con axe sulle pagine e sul portale.
- **Mai** salvare nel repository token, password, link di accesso o dati delle clienti.
