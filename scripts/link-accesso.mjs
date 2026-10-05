#!/usr/bin/env node
/**
 * Prepara il link privato per l'area di Jessica: serve per la prima attivazione
 * oppure, se la password è stata dimenticata, per sceglierne una nuova.
 *
 *   npm run link-accesso                  → sito pubblicato (SITE_URL o Railway)
 *   npm run link-accesso -- https://dominio.it
 *   npm run link-accesso -- --ore 72      → durata del link (predefinita 48 ore)
 *
 * Il link funziona una sola volta e scade da solo. Non salvarlo nel repository.
 */
import { randomBytes } from 'node:crypto';

const PRODUCTION = 'https://desideri-di-felicita-production.up.railway.app';
const args = process.argv.slice(2);
let hours = 48;
let origin = process.env.SITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : PRODUCTION);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--ore') hours = Number(args[++index]);
  else origin = args[index];
}
if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 14) {
  console.error('Indica una durata da 1 a 336 ore, per esempio: npm run link-accesso -- --ore 48');
  process.exit(1);
}
let url;
try { url = new URL(origin); } catch { url = null; }
if (!url || !['http:', 'https:'].includes(url.protocol)) {
  console.error('Indica l’indirizzo del sito, per esempio: npm run link-accesso -- https://desideridifelicita.it');
  process.exit(1);
}
const token = randomBytes(32).toString('base64url');
const expiresAt = new Date(Date.now() + hours * 3_600_000);
const expiry = expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
const local = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' }).format(expiresAt);

console.log(`
Link di accesso per l’area di Jessica
=====================================

1. Su Railway apri il servizio «desideri-di-felicita» → Variables e imposta:

   ADMIN_BOOTSTRAP_TOKEN=${token}
   ADMIN_BOOTSTRAP_EXPIRES_AT=${expiry}

   (con la Railway CLI: railway variables --set "ADMIN_BOOTSTRAP_TOKEN=${token}" --set "ADMIN_BOOTSTRAP_EXPIRES_AT=${expiry}")

2. Attendi che il servizio si riavvii (1–2 minuti).

3. Manda a Jessica questo link, valido una sola volta fino a ${local}:

   ${url.origin}/admin#attiva=${token}

   • Se l’agenda non è ancora attiva, Jessica sceglie email e password.
   • Se è già attiva, Jessica sceglie una nuova password e gli altri dispositivi vengono scollegati.

Il link non va pubblicato né salvato nel repository.
`);
