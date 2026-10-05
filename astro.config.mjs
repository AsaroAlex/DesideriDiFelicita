// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Indirizzo ufficiale del sito (Railway). Per un dominio personalizzato impostare
// SITE_URL (es. https://desideridifelicita.it) nelle variabili Railway e ripubblicare.
const PRODUCTION_URL = 'https://desideri-di-felicita-production.up.railway.app';

// Le variabili vengono lette al build: SITE_URL prevale sul dominio fornito da Railway.
const siteUrl = process.env.SITE_URL?.trim();
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
const configuredSite = siteUrl || (railwayDomain ? `https://${railwayDomain}` : PRODUCTION_URL);

/** @param {string} value */
function validateOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SITE_URL deve essere un’origine assoluta http:// o https://.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) {
    throw new Error('SITE_URL deve contenere solo un’origine http:// o https://, senza percorso, credenziali, query o frammento.');
  }
  return url.origin;
}

const site = validateOrigin(configuredSite);
const configuredBase = process.env.BASE_PATH?.trim();
const base = configuredBase || '/';
if (!base.startsWith('/') || base.includes('//') || /[?#\\]/.test(base)) {
  throw new Error('BASE_PATH deve essere un percorso assoluto, per esempio / oppure /DesideriDiFelicita.');
}
const homeUrl = `${site}${base}`.replace(/\/+$/, '');

// https://astro.build/config
export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      filter: (page) => !/\/(admin|agenda|appuntamento|404)(?:\.html)?\/?$/.test(new URL(page).pathname),
      changefreq: 'weekly',
      lastmod: new Date(),
      serialize(item) {
        // La home ha priorità massima, le altre pagine leggermente inferiore.
        item.priority = item.url.replace(/\/+$/, '') === homeUrl ? 1.0 : 0.7;
        return item;
      },
    }),
  ],
});
