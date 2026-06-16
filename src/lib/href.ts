/**
 * Prefissa un percorso interno con la `base` configurata in astro.config.mjs.
 * Necessario perché su GitHub Pages di progetto il sito vive in
 * "/<nome-repo>/" e i link assoluti devono includere quel prefisso.
 *
 * Esempi (base = "/DesideriDiFelicita/"):
 *   withBase('/servizi')      -> "/DesideriDiFelicita/servizi"
 *   withBase('favicon.svg')   -> "/DesideriDiFelicita/favicon.svg"
 */
export function withBase(path = ''): string {
  const base = import.meta.env.BASE_URL; // es. "/DesideriDiFelicita/" oppure "/"
  const clean = path.replace(/^\/+/, '');
  return base.endsWith('/') ? base + clean : `${base}/${clean}`;
}
