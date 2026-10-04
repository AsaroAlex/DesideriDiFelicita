// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const GH_USER = 'asaroalex';
const REPO = 'DesideriDiFelicita';

// Senza variabili rimane il deploy GitHub Pages di progetto. Su Railway il
// dominio pubblico viene fornito dalla piattaforma; SITE_URL permette di usare
// un dominio personalizzato. Entrambe le variabili vanno impostate al build.
const siteUrl = process.env.SITE_URL?.trim();
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
const configuredSite = siteUrl || (railwayDomain ? `https://${railwayDomain}` : null);

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

const site = validateOrigin(configuredSite || `https://${GH_USER}.github.io`);
const configuredBase = process.env.BASE_PATH?.trim();
const base = configuredBase || (configuredSite ? '/' : `/${REPO}`);
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
