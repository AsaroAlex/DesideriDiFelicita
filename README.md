# Desideri di Felicità — Design System

> **«La bellezza nasce da un desiderio, la felicità lo rende reale.»**
> Tagline: *Creiamo insieme il tuo momento felice.*

The brand system for **Desideri di Felicità**, the hair salon of **Jessica Asaro**
in Galliera (BO), Italy. Specialty: **cura del capello riccio** (curly-hair care),
alongside cuts, colour, balayage, styling and treatments.

The product is a **static showcase site** ("sito vetrina") — Astro + TypeScript, no
e-commerce or online booking. It is built for **local conversion and SEO**, and is
**mobile-first** (clients arrive mostly from a phone). The aesthetic is **editorial
luxury / "maison"**: warm, feminine, romantic, with bright cream sections punctuated
by cinematic dark ones. Booking happens through **WhatsApp**, phone, or Instagram DM.

---

## Sources (single source of truth)

This system was distilled from the salon's own repository. If you have access, read
these to go deeper — the design tokens and content there are authoritative:

- **GitHub:** https://github.com/AsaroAlex/DesideriDiFelicita
  (branch explored: `claude/jolly-babbage-hrjwz7`)
  - `src/styles/tokens.css` — the aesthetic source of truth (CSS custom properties).
  - `src/styles/global.css` — base element styles, buttons, cards, reveal/View-Transitions.
  - `src/data/site.ts` — all copy, contacts, hours, services, reviews, FAQ, SEO.
  - `src/data/images.ts` — image manifest & alt text.
  - `src/components/*.astro` — Header, Hero, ServiceCard, Testimonials, Faq, Footer,
    WhatsappButton, Logo, Gallery, MapEmbed, Breadcrumbs.
- **Instagram:** [@desideri.di.felicita](https://www.instagram.com/desideri.di.felicita/)
- **Google Business:** confirmed contacts, address and reviews.

> **Confirmed vs. to-confirm.** Owner, slogan, phone, email, address and opening hours
> are confirmed. **Prices** ("su richiesta") and **exact GPS** are not — the brand shows
> a `Badge variant="tbc"` ("da confermare" / "su richiesta") until they are. Honor this.

---

## CONTENT FUNDAMENTALS

**Language:** Italian, always. **Address the reader informally with «tu»** ("su misura
per te", "il tuo momento felice", "passa a trovarci"). The brand voice is **elegant,
warm, reassuring, feminine and romantic** — a confiding *maison* tone, never salesy or
shouty, never urgent.

- **First person plural for the salon** ("creiamo", "la nostra specialità"), shifting to
  **first person singular for Jessica** on the About page ("Ciao, sono Jessica").
- **Sentences are short and sensory**, centered on care, listening and feeling good:
  *"Ogni look nasce dall'ascolto del tuo desiderio."*
- **Eyebrows / labels** are short noun phrases in spaced uppercase: *LA NOSTRA SPECIALITÀ,
  I NOSTRI SERVIZI, DICONO DI NOI, DOMANDE FREQUENTI.*
- **The slogan** is the romantic anchor and appears as a serif italic quote with guillemets
  («…»). **The tagline** ("Creiamo insieme il tuo momento felice.") is the warmer CTA voice.
- **No emoji.** No exclamation-heavy hype. Accent words inside headings are set in *gold
  italic* (e.g. "ogni look nasce dall'*ascolto*").
- **Casing:** the wordmark is lowercase ("Desideri di felicità"); headings are sentence
  case; eyebrows are UPPERCASE with `0.22em` tracking.
- **CTAs** lead with the action: *Prenota su WhatsApp · Chiama ora · Scopri i servizi.*

---

## VISUAL FOUNDATIONS

**Overall:** editorial luxury, mobile-first. A **warm cream light world** carries most of
the page; **deep navy/slate dark sections** appear for high-impact "values" moments,
creating cinematic contrast. Generous whitespace, a fluid type scale, soft warm shadows,
and one calm signature easing.

**Color.** Dusty-blue **primary** (`#4a5d7a`/`#374a64`), warm **gold/bronze accent**
(`#c2a268`/`#a6864a`), **powder-rose** softener (`#e6c3c6`/`#f7eded`), on cream
(`#f8f5f0`) / white surfaces / sand-alt (`#f1ebe1`). Text is slate-navy ink with a soft
and a muted step. Dark sections invert to navy (`#1e2733`→`#28323f`) with light text and
a lighter gold (`#d4b277`). WhatsApp green (`#25d366`) is reserved for the booking action.
Gold is **accent only** (eyebrows, italic heading words, hover borders, index numerals) —
never body text. **For AA contrast, small gold text on light (eyebrows, badge labels) uses
`--color-gold-text` `#856832` (4.80:1)**; `--color-gold`/`--color-gold-strong` are reserved
for large display words, icons and borders. Secondary/muted text is `#687085` (4.55:1 on cream).

**Type.** Display/headings in **Fraunces** (variable, high-contrast serif; weights ~440–460;
italics for gold accent words). Body in **Manrope** (variable sans; line-height 1.65).
The **logo wordmark** uses **Quicksand**. Eyebrow labels: uppercase, `0.22em` tracking,
gold. Fluid `clamp()` scale from `0.8125rem` to `~7rem` (display). Headings use
`text-wrap: balance`, body uses `text-wrap: pretty`, with tight negative tracking on display.

**Spacing & layout.** Scale `0.25rem → 6.5rem`. Container `75rem` (narrow `46rem` for prose),
fluid gutter, header height `4.75rem`. Sections breathe with `6.5rem` vertical padding.
Grids: services 3-up, values 4-up, gallery 3-up (2-up on tablet, 1 on phone).

**Shape.** Radii `6 / 14 / 22 / 32px` plus pill `999px`. **Buttons are always pills.**
**Cards** are white, `22px` radius, hairline `#e6ded2` border, soft `shadow-sm`; on hover
they **rise 5px**, deepen to `shadow-md`, and the border tints toward gold. Images use
`22–32px` radii; hero/portrait crops are **4:5**, gallery crops **3:4**.

**Backgrounds & texture.** No flat fills alone: the hero layers a soft blush radial + a
cream→sand vertical gradient, with two large **blurred glow orbs** (gold top-right, blue
bottom-left). A very subtle **fractal-noise grain** (≈3.5% opacity) overlays the whole page
for an editorial print feel. Dark sections use a `170deg` navy gradient. No photographic
full-bleed hero — imagery sits in **rounded framed cards**, not edge-to-edge.

**Imagery.** Warm, natural salon photography — real results (curls, balayage, waves),
the salon interior (terracotta plaster walls), and Jessica at work. Tones are warm and
golden, not cool or high-fashion-cold. Crops are portrait/editorial. *Some professional
photos still carry a photographer watermark (Chiara Mascellani) and are flagged in the
source as placeholders to swap for clean versions.*

**Motion.** One signature easing — `cubic-bezier(0.22, 1, 0.36, 1)`. Default transition
`240ms`, slow `620ms`. Hero elements **fade-and-rise** in a short stagger; content
**reveals gently on scroll**; pages cross-fade via native **View Transitions**. No bounces,
no parallax, no infinite loops. Everything is gated behind `prefers-reduced-motion`.
**Reveal pattern:** the at-rest state is always *visible* — the entrance only animates inside
`@media (prefers-reduced-motion: no-preference)` with no `fill-mode`, so a throttled or pending
animation timeline (background tab, prerender, PDF export) never leaves content stuck at `opacity:0`.

**Interaction states.** *Hover:* buttons rise `-2px` + `shadow-md` and shift to the
stronger colour; cards rise `-5px` with a gold-tinted border; nav links grow a gold
underline left-to-right; gallery images zoom `~1.045` under a gradient caption.
*Press:* buttons settle back to baseline (no harsh shrink). *Focus:* a **3px gold
outline** with `3px` offset on every interactive element. *Disabled:* 50% opacity.

**Transparency & blur.** The sticky header is a translucent cream pane with
`backdrop-filter: blur(10px)` that solidifies and gains a hairline border + shadow on
scroll. Otherwise transparency is used sparingly (glow orbs, caption gradients).

---

## ICONOGRAPHY

The salon site does **not** use an icon font or external icon library. Icons are a small
set of **inline SVGs**, thin and rounded, matching the logo's mono-line feel and inheriting
`currentColor` at `1em`. They are provided here as the `Icon` component
(`components/core/Icon.jsx`):

- **Filled glyphs, lifted verbatim from the codebase:** `whatsapp`, `phone`, `star`
  (the gold review star).
- **Stroked glyphs (thin, rounded) for this system:** `instagram`, `mapPin`, `scissors`,
  `clock`, `arrowRight`.

**No emoji** are ever used. Unicode is used only for typographic touches — guillemets
«…», the curly apostrophe ', the middot · in eyebrows/meta, and zero-padded numerals
("01", "02") set in Fraunces with tabular figures. The WhatsApp glyph is a utility
mark only and uses a muted sage treatment so it does not overpower the brand.

**Brand marks** live in `assets/brand/` and `public/images/brand/`: the current
public logo is `logo.svg`, plus `emblema.svg`, `emblema-mono.svg`,
`emblema-reverse.svg` and `favicon.svg`. The live `Logo` component now uses a
typographic wordmark only; avoid the previous mono-line curl mark because it could be
read as the number `5`. The small emblem/favicons are intentionally reduced to a
simple italic `D` until a definitive salon mark is approved.
*Note: the logo is still being finalised by the salon and is not yet definitive.*

---

## FONTS — substitution flag

The salon repo **self-hosts** the variable fonts (`Fraunces Variable`, `Manrope Variable`)
via `@fontsource` and uses `Quicksand` for the wordmark. This package loads the **Google
Fonts equivalents** (see the `@import url(...)` at the top of `styles.css`) so the family
names resolve everywhere. **➜ Action:** for production, drop in the self-hosted binaries
and `@font-face` rules under the same family names (`'Fraunces Variable'`, `'Manrope
Variable'`) — the tokens already point at them with a graceful fallback stack.

---

## INDEX — what's in this folder

**Foundations**
- `styles.css` — the entry point (import this one file). `@import`-only manifest.
- `tokens/colors.css` · `typography.css` · `spacing.css` · `motion.css` · `fonts.css`
  — CSS custom properties (base values + semantic aliases).

**Components** (`components/<group>/` — React primitives, bundled as `window.DesideriDiFelicitDesignSystem_dcc6e0`)
- `core/` — **Button**, **Eyebrow**, **Badge**, **SectionHeading**, **Icon**
- `brand/` — **Logo**
- `content/` — **ServiceCard**, **TestimonialCard**, **StarRating**, **FaqItem**, **GalleryFigure**
- `actions/` — **WhatsappButton** (inline + floating)

**UI Kit** (`ui_kits/website/`)
- `index.html` — interactive multi-page recreation of the vetrina site
  (Home · Servizi · Galleria · Chi siamo · Contatti) with the sticky header, hero,
  services grid, dark values section, gallery, Google testimonials, FAQ accordion,
  contact + hours, footer and floating WhatsApp button.
- `sections.jsx` — section components composed from the design-system primitives.
- `data.js` — site copy & data (mirrors `src/data/site.ts`).

**Specimen cards** (`guidelines/*.card.html`) — the Design System tab gallery:
Colors, Type, Spacing and Brand foundation cards.

**Assets** (`assets/`)
- `brand/` — logo, emblems, favicon.
- `images/` — `hero/`, `gallery/`, `salon/`, `team/` photography.

**Other**
- `SKILL.md` — lets this folder be used as a downloadable Agent Skill.

---

*Built from the Desideri di Felicità repository. Explore
[github.com/AsaroAlex/DesideriDiFelicita](https://github.com/AsaroAlex/DesideriDiFelicita)
for the authoritative tokens, content and components.*
