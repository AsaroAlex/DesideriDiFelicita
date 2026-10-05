#!/usr/bin/env node
/**
 * Il sito ufficiale (con calendario e agenda) è quello su Railway. Il vecchio
 * indirizzo GitHub Pages resta attivo solo per non rompere i link già condivisi:
 * ogni pagina reindirizza alla stessa pagina del sito ufficiale.
 *
 *   PRODUCTION_URL=https://dominio.it node scripts/pages-redirect.mjs
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const target = new URL(process.env.PRODUCTION_URL || 'https://desideri-di-felicita-production.up.railway.app').origin;
const out = 'dist-redirect';
const pages = ['', 'servizi/', 'galleria/', 'chi-siamo/', 'contatti/', 'prenota/', 'privacy/'];
const escape = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function page(path) {
  const url = `${target}/${path}`;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desideri di Felicità · nuovo indirizzo</title>
<link rel="canonical" href="${escape(url)}">
<meta http-equiv="refresh" content="0; url=${escape(url)}">
<script>location.replace(${JSON.stringify(url)} + location.hash);</script>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;color:#0b1220}a{color:#1e54c8}</style>
</head>
<body><p>Il sito di Desideri di Felicità si è spostato: <a href="${escape(url)}">vai al nuovo indirizzo</a>.</p></body>
</html>
`;
}

// Unknown or old paths: keep the part after /DesideriDiFelicita/ when possible.
const notFound = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desideri di Felicità · nuovo indirizzo</title>
<meta name="robots" content="noindex">
<script>
  var path = location.pathname.replace(/^\\/DesideriDiFelicita(?=\\/|$)/, '') || '/';
  location.replace(${JSON.stringify(target)} + path + location.search + location.hash);
</script>
</head>
<body><p>Il sito di Desideri di Felicità si è spostato: <a href="${escape(target)}/">vai al nuovo indirizzo</a>.</p></body>
</html>
`;

await rm(out, { recursive: true, force: true });
for (const path of pages) {
  await mkdir(join(out, path), { recursive: true });
  await writeFile(join(out, path, 'index.html'), page(path));
}
await writeFile(join(out, '404.html'), notFound);
await writeFile(join(out, '.nojekyll'), '');
console.log(`Reindirizzamenti verso ${target} creati in ${out}/ (${pages.length} pagine + 404).`);
