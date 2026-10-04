import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from './domain.mjs';
import { whatsappConfiguration } from './whatsapp.mjs';

const AAD = Buffer.from('desideri-di-felicita:whatsapp-config:v1');
const SECRET_FIELDS = ['accessToken', 'appSecret', 'verifyToken'];
const MISSING_SECRET_NAMES = { appSecret: 'WHATSAPP_APP_SECRET', verifyToken: 'WHATSAPP_VERIFY_TOKEN' };

function encryptionKey(value) {
  if (Buffer.isBuffer(value)) return value.length === 32 ? Buffer.from(value) : null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value ? decoded : null;
}

function validateText(value, field, maximum, pattern) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new DomainError(400, 'invalid_whatsapp_configuration', 'Controlla i dati del collegamento WhatsApp.');
  }
  const text = value.trim();
  if (text && pattern && !pattern.test(text)) {
    throw new DomainError(400, 'invalid_whatsapp_configuration', `Il campo ${field} non è valido.`);
  }
  return text;
}

/** Secrets are authenticated-encrypted with a key held outside SQLite. */
export function createWhatsappSettings({ store, config, now = Date.now }) {
  const db = store.db;
  const key = encryptionKey(config.whatsappConfigKey);
  db.exec(`CREATE TABLE IF NOT EXISTS owner_whatsapp_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL CHECK (version = 1),
    iv BLOB NOT NULL, auth_tag BLOB NOT NULL, ciphertext BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const read = db.prepare('SELECT version, iv, auth_tag, ciphertext FROM owner_whatsapp_config WHERE id = 1');

  function resolve() {
    const row = read.get();
    if (row) {
      // A persisted pause must never fall back to active environment credentials.
      if (!key) return { source: 'portal', readable: false, whatsapp: { enabled: false } };
      try {
        if (row.version !== 1 || row.iv.length !== 12 || row.auth_tag.length !== 16) throw new Error('Invalid envelope');
        const decipher = createDecipheriv('aes-256-gcm', key, row.iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(row.auth_tag);
        const whatsapp = JSON.parse(Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8'));
        if (!whatsapp || typeof whatsapp !== 'object' || Array.isArray(whatsapp) || typeof whatsapp.enabled !== 'boolean') throw new Error('Invalid configuration');
        return { source: 'portal', readable: true, whatsapp };
      } catch { return { source: 'portal', readable: false, whatsapp: { enabled: false } }; }
    }
    const environment = config.whatsapp || {};
    const source = [...SECRET_FIELDS, 'phoneNumberId', 'templateName'].some((name) => Boolean(environment[name])) ? 'environment' : 'none';
    return { source, readable: true, whatsapp: { ...environment, enabled: environment.enabled !== false && whatsappConfiguration(environment).configured && Boolean(environment.appSecret && environment.verifyToken) } };
  }

  function safeStatus() {
    const { source, readable, whatsapp } = resolve();
    const basic = whatsappConfiguration(whatsapp);
    const webhookConfigured = Boolean(whatsapp.appSecret && whatsapp.verifyToken);
    const missing = [...basic.missing, ...Object.entries(MISSING_SECRET_NAMES).filter(([name]) => !whatsapp[name]).map(([, name]) => name)];
    return {
      storageAvailable: Boolean(key && readable), source, enabled: whatsapp.enabled === true,
      configured: basic.configured, webhookConfigured, missing,
      phoneNumberId: whatsapp.phoneNumberId || '', templateName: whatsapp.templateName || '',
      templateLanguage: whatsapp.templateLanguage || 'it', graphVersion: whatsapp.graphVersion || 'v26.0',
      secrets: Object.fromEntries(SECRET_FIELDS.map((name) => [name, Boolean(whatsapp[name])])),
      webhookUrl: `${new URL(config.origin).origin}/api/whatsapp/webhook`,
    };
  }

  function update(input) {
    const current = resolve();
    if (!key || !current.readable) {
      throw new DomainError(503, 'whatsapp_storage_unavailable', 'Il collegamento WhatsApp non è disponibile. Contatta chi gestisce il sito.');
    }
    const allowed = new Set(['currentPassword', 'enabled', 'phoneNumberId', 'templateName', 'templateLanguage', 'graphVersion', ...SECRET_FIELDS]);
    if (Object.keys(input).some((name) => !allowed.has(name)) || (input.enabled !== undefined && typeof input.enabled !== 'boolean')) {
      throw new DomainError(400, 'invalid_whatsapp_configuration', 'Controlla i dati del collegamento WhatsApp.');
    }
    const whatsapp = {
      enabled: input.enabled ?? false,
      phoneNumberId: validateText(input.phoneNumberId ?? current.whatsapp.phoneNumberId ?? '', 'ID numero', 32, /^\d{1,32}$/),
      templateName: validateText(input.templateName ?? current.whatsapp.templateName ?? '', 'nome modello', 512, /^[a-z0-9_]{1,512}$/),
      templateLanguage: validateText(input.templateLanguage ?? current.whatsapp.templateLanguage ?? 'it', 'lingua', 16, /^[a-z]{2,3}(?:_[A-Z]{2})?$/),
      graphVersion: validateText(input.graphVersion ?? current.whatsapp.graphVersion ?? 'v26.0', 'versione API', 16, /^v\d{1,3}\.\d{1,3}$/),
    };
    for (const name of SECRET_FIELDS) {
      const proposed = input[name] === undefined ? '' : validateText(input[name], 'credenziale', name === 'accessToken' ? 8192 : 512);
      whatsapp[name] = proposed || current.whatsapp[name] || '';
    }
    const ready = whatsappConfiguration(whatsapp).configured && Boolean(whatsapp.appSecret && whatsapp.verifyToken);
    if (whatsapp.enabled && !ready) {
      throw new DomainError(400, 'incomplete_whatsapp_configuration', 'Completa le credenziali del numero, del modello e del webhook prima di attivare i promemoria.');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(whatsapp), 'utf8'), cipher.final()]);
    store.transaction(() => {
      db.prepare(`INSERT INTO owner_whatsapp_config (id, version, iv, auth_tag, ciphertext, updated_at)
        VALUES (1, 1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        version = excluded.version, iv = excluded.iv, auth_tag = excluded.auth_tag,
        ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`)
        .run(iv, cipher.getAuthTag(), ciphertext, now());
      db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)')
        .run('owner_whatsapp_configuration_changed', '1', now(), '{}');
    });
    return safeStatus();
  }

  return { getStatus: safeStatus, update, getWhatsappConfig: () => resolve().whatsapp };
}
