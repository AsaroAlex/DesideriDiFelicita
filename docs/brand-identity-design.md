# Identità visiva — Desideri di Felicità

> Documento di progetto del marchio e della suite brand.
> Stato: **marchio bloccato**, in attesa di revisione utente prima dell'esecuzione.
> Data: 2026-06-16 · Titolare: Jessica Asaro (Hair Stylist) · Galliera (BO)

## 1. Contesto

Il sito vetrina Astro è già online, ma il brand non ha ancora un **logo reale**: il
nome è solo testo e la favicon è un monogramma "Df" provvisorio. L'utente vuole
un'identità visiva completa **di livello alto** ("da premio") + l'applicazione al sito
e una suite per social, stampa e merchandising.

Percorso creativo (sintesi delle iterazioni, per memoria):
- Scartati: forbici disegnate (cliché), monogramma DF geometrico squadrato (freddo),
  emblema floreale ricco (sembrava un fioraio), cornice‑crest (datata).
- Direzione vincente: **monogramma DF a linea morbida e continua**, minimal ma caldo
  (riferimenti utente: Juventus/Apple/Google), con un **ricciolo** che lo rende
  inequivocabilmente *hair stylist*.

## 2. Decisioni bloccate

| Elemento | Decisione |
|---|---|
| **Tipo di marchio** | Monogramma‑legatura **D+F** a linea continua (monolinea), con ricciolo |
| **Enfasi** | F sobria in **slate**; **ansa/ricciolo della D in oro** (l'occhio va sul "capello") |
| **Variante** | "Solo ricciolo" — **nessun attrezzo** (no forbici/phon: appesantiscono e tornano cliché) |
| **Stile** | Minimal, morbido, caldo, senza tempo. No ornamenti, no cornici, no gradienti datati |
| **Palette** | slate `#34425c`, oro `#c2a268`, blush `#e6c3c6`, crema `#f8f5f0`, navy `#1e2733` (= token già nel sito) |

### Marchio — SVG di riferimento (V2, da rifinire al millimetro in esecuzione)

```svg
<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
  <!-- F + gambo (slate) -->
  <g fill="none" stroke="#34425c" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
    <path d="M138 48 L72 48 C66 48 64 52 64 58 L64 150"/>
    <path d="M64 101 L112 101"/>
  </g>
  <!-- ansa D + ricciolo (oro) -->
  <path d="M64 150 C64 182 98 194 126 176 C156 158 160 110 122 94 C102 86 88 102 100 118 C107 127 120 122 117 112"
        fill="none" stroke="#c2a268" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

> In esecuzione: curva del ricciolo perfezionata, raccordi e spessori ottimizzati,
> versione "outline" convertita in tracciati per i font/ricamo.

## 3. Wordmark, font e lockup (bloccati)

- **Font del nome:** **sans moderno e caldo** (rif. **Quicksand**, curve rotonde),
  coerente col marchio e con i riferimenti citati (Apple/Google, "senza tempo").
  Da valutare in esecuzione il self‑hosting (come già fatto per Manrope/Fraunces).
- **Sottotitolo:** `JESSICA ASARO · HAIR STYLIST` (Manrope, maiuscolo, tracking ~.14em).
- **Body/UI del sito:** **Manrope** (già presente). **Fraunces** resta opzionale come
  carattere editoriale per alcuni titoli, se vogliamo un tocco romantico (non nel logo).

### Lockup e matrice d'uso (tutte le versioni approvate)

| Lockup | Uso principale |
|---|---|
| **Orizzontale** (marchio + nome a fianco) | Header sito, carta intestata, firme |
| **Impilato** (marchio sopra, nome+sottotitolo sotto) | Biglietto, social, insegna, timbro |
| **Solo emblema** (ricciolo) | Favicon, avatar, icona app, ricamo |
| **Chiaro / Scuro** | Versione per fondo crema vs fondo navy |

Compattezza: marchio e testo ravvicinati, sottotitolo largo ~quanto il nome
(no spaziatura dispersiva).

## 4. Suite di asset (deliverable)

1. **Lockup logo**
   - Orizzontale (marchio + nome a fianco) — header, insegna, biglietti.
   - Verticale/impilato (marchio sopra, nome sotto) — social, timbro.
   - Solo marchio (emblema) — avatar, favicon, ricamo.
2. **Varianti colore** (per ogni lockup): full‑color (slate+oro), monocromo slate,
   monocromo oro, **bianco/reverse** (su fondo scuro), **nero 1 colore** (stampa/ricamo).
3. **Favicon** multi‑size (`.svg` + fallback) e **icona app** (quadrato arrotondato).
4. **Kit social**: avatar Instagram, cover storie in evidenza, 2 template post, 1 template storia.
5. **Stampa**: biglietto da visita (fronte/retro), carta intestata.
6. **Timbro/tondo** (ceralacca/packaging) e **versione ricamo 1 colore** (divisa).
7. **Immagine OG** (1200×630) per anteprime social/SEO.
8. **Mini brand‑guide** (1 pagina): uso del logo, area di rispetto, dimensione minima,
   colori (HEX), font, do/don't.

## 5. Formati e organizzazione file (nel repo)

- **Sorgenti vettoriali (verità):** SVG in `src/assets/images/brand/`
  (`logo-orizzontale.svg`, `logo-stacked.svg`, `emblema.svg`, varianti colore).
- **Statici/OG/favicon:** `public/` (`favicon.svg`, `public/images/og/og-default.jpg`),
  collegati come da convenzioni esistenti (`src/data/images.ts`).
- **Export raster** (PNG a varie misure) e **PDF stampa** per biglietti → cartella
  `docs/brand/` (non serviti dal sito).
- Naming come da `CLAUDE.md §9` (minuscolo, trattini).

## 6. Applicazione al sito (scope MINIMO prima, poi estensione)

**Scope minimo (questa fase):**
- `src/components/Header.astro` — sostituire il wordmark testuale con il **logo SVG** (marchio + nome).
- `src/components/Footer.astro` — logo (versione reverse su fondo scuro se applicabile).
- `public/favicon.svg` — nuovo **emblema** (sostituisce il "Df" provvisorio).
- `public/images/og/og-default.jpg` — nuova **immagine OG** brandizzata.
- `src/lib/structured-data.ts` / `Seo.astro` — campo `logo` JSON‑LD → nuovo asset.
- Token palette: **invariati** (già allineati al brand).

**Estensione (dopo, se vuoi):** logo nell'hero, micro‑applicazioni grafiche del ricciolo
come elemento decorativo discreto, refinement visivo coordinato delle sezioni.

## 7. Fuori scope (per ora)

Redesign visivo completo del sito; foto reali (vedi `docs/brief-fotografo.md`);
gestione fornitore di stampa; e‑commerce/booking.

## 8. Verifica (fine esecuzione)

- `npm run build` verde; sito si avvia.
- Logo corretto in **header, footer, favicon, OG** (controllo visivo via screenshot).
- Marchio nitido a tutte le misure (favicon 16–32px → insegna) e in **1 colore** (ricamo).
- Accessibilità: `alt`/`aria-label` sul logo, contrasto AA, focus visibili.
- Tutti i file SVG ottimizzati; nessun file generato non voluto in `git status`.

## 9. Decisioni aperte da confermare

1. **Scope sito** — confermi lo scope minimo (logo in header/footer + favicon + OG)
   prima di estendere al resto del sito?
2. **Suite** — l'elenco al §4 va bene così, o togliamo/aggiungiamo qualcosa
   (es. priorità: prima sito + biglietto + social, poi il resto)?
3. **Commit** — vuoi che committi questo documento (e poi gli asset) o tengo tutto locale?

> Risolto: marchio ("solo ricciolo"), lockup (tutte le versioni, uso contestuale),
> font del nome (sans moderno), sottotitolo (Jessica Asaro · Hair Stylist), palette.
