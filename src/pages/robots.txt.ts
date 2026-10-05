import type { APIRoute } from 'astro';

/**
 * robots.txt generato dinamicamente: include il link alla sitemap usando il
 * dominio e la base configurati in astro.config.mjs (così resta corretto sia
 * su GitHub Pages di progetto sia, in futuro, con il dominio personalizzato).
 */
export const GET: APIRoute = ({ site }) => {
  // Assicura uno slash finale alla base (può essere "/DesideriDiFelicita" o "/")
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const sitemapUrl = site
    ? new URL(`${base}sitemap-index.xml`, site).href
    : '/sitemap-index.xml';

  const body = `User-agent: *
Allow: /
Disallow: ${base}agenda
Disallow: ${base}admin
Disallow: ${base}appuntamento
Disallow: ${base}api/

Sitemap: ${sitemapUrl}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
