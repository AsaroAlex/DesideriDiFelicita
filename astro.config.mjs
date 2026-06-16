// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * CONFIGURAZIONE DEPLOY
 * ---------------------
 * Per ora il sito viene pubblicato come "GitHub Pages di progetto":
 *   https://asaroalex.github.io/DesideriDiFelicita/
 * Quindi: site = origine del dominio, base = "/<nome-repo>".
 *
 * QUANDO avrai un DOMINIO PERSONALIZZATO (es. https://desideridifelicita.it):
 *   1. metti USE_CUSTOM_DOMAIN = true
 *   2. aggiorna CUSTOM_DOMAIN con il dominio reale
 *   3. crea il file public/CNAME contenente SOLO il dominio (senza https://)
 *   4. rifai il deploy
 * Con il dominio custom, base diventa "/" e i link/asset puntano alla radice.
 */
const USE_CUSTOM_DOMAIN = false;
const CUSTOM_DOMAIN = 'https://desideridifelicita.it'; // <-- placeholder, da confermare

const GH_USER = 'asaroalex';
const REPO = 'DesideriDiFelicita';

const site = USE_CUSTOM_DOMAIN ? CUSTOM_DOMAIN : `https://${GH_USER}.github.io`;
const base = USE_CUSTOM_DOMAIN ? '/' : `/${REPO}`;

// https://astro.build/config
export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [sitemap()],
});
