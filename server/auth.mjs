import { randomBytes, createHash, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainError } from './domain.mjs';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'dd_felicita_session';
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;
// «Resta collegata su questo dispositivo»: scelta esplicita della titolare.
const REMEMBERED_SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const USED_LINKS_KEY = 'owner_access_links_used';
const linkHash = (token) => createHash('sha256').update(`owner-access-link:${token}`).digest('hex');
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const digest = (value) => createHash('sha256').update(value).digest();
const sessionHash = (value) => digest(value).toString('hex');

export function equalSecrets(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return timingSafeEqual(digest(left), digest(right));
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new DomainError(400, 'invalid_password', 'Scegli una password di almeno 12 caratteri (massimo 256).');
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new DomainError(400, 'invalid_email', 'Inserisci un indirizzo email valido.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DomainError(400, 'invalid_email', 'Inserisci un indirizzo email valido.');
  }
  return email;
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$16384$8$1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length > 256 || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const candidate = await scrypt(password, parts[4], 64, SCRYPT_OPTIONS);
  return timingSafeEqual(candidate, Buffer.from(parts[5], 'hex'));
}

function parseSessionCookie(request) {
  const cookie = request.headers.cookie || '';
  if (cookie.length > 8192) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) {
      const token = rest.join('=');
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

export function createAuth({ store, config, now = Date.now }) {
  const db = store.db;
  const ownerQuery = db.prepare('SELECT id, email, password_hash FROM owners WHERE id = 1');
  const secure = config.production === true || new URL(config.origin).protocol === 'https:';
  const cookie = (token, clear = false, lifetime = SESSION_LIFETIME) => `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : lifetime / 1000}${secure ? '; Secure' : ''}`;
  const remember = (value) => {
    if (value !== undefined && typeof value !== 'boolean') throw new DomainError(400, 'invalid_input', 'Scegli se restare collegata su questo dispositivo.');
    return value === true ? REMEMBERED_SESSION_LIFETIME : SESSION_LIFETIME;
  };
  const usedLinksQuery = db.prepare('SELECT value FROM settings WHERE key = ?');
  const saveUsedLinks = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  function usedLinks() {
    const row = usedLinksQuery.get(USED_LINKS_KEY);
    if (!row) return null;
    try { const list = JSON.parse(row.value); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  const linkUsed = (token) => (usedLinks() || []).includes(linkHash(token));
  function markLinkUsed(token) {
    const list = usedLinks() || [];
    if (!list.includes(linkHash(token))) saveUsedLinks.run(USED_LINKS_KEY, JSON.stringify([...list, linkHash(token)].slice(-50)));
  }
  // One-time migration: on an agenda activated before access links were
  // tracked, the configured link is the original activation link and must
  // never become a password-reset link. Later links are tracked when used.
  store.transaction(() => {
    if (usedLinks() !== null) return;
    saveUsedLinks.run(USED_LINKS_KEY, JSON.stringify(config.bootstrapToken && ownerQuery.get() ? [linkHash(config.bootstrapToken)] : []));
  });
  const sessionShape = (session) => session
    ? { authenticated: true, email: session.email, csrfToken: session.csrfToken }
    : { authenticated: false, setupRequired: !ownerQuery.get() };
  let dummyHash;

  function createSession(owner, instant, lifetime = SESSION_LIFETIME) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(instant);
    db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sessionHash(token), owner.id, csrfToken, instant + lifetime, instant);
    return { session: { email: owner.email, csrfToken }, cookie: cookie(token, false, lifetime) };
  }

  function getSession(request) {
    const token = parseSessionCookie(request);
    if (!token) return null;
    const row = db.prepare('SELECT s.id_hash, s.csrf_token, s.expires_at, s.created_at, o.email FROM sessions s JOIN owners o ON o.id = s.user_id WHERE s.id_hash = ?')
      .get(sessionHash(token));
    if (!row) return null;
    if (row.expires_at <= now()) {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(row.id_hash);
      return null;
    }
    return { idHash: row.id_hash, email: row.email, csrfToken: row.csrf_token, lifetime: row.expires_at - row.created_at > SESSION_LIFETIME ? REMEMBERED_SESSION_LIFETIME : SESSION_LIFETIME };
  }

  function requireSession(request) {
    const session = getSession(request);
    if (!session) throw new DomainError(401, 'authentication_required', 'Accedi per aprire l’agenda.');
    return session;
  }

  function checkCsrf(request, session) {
    if (!equalSecrets(request.headers['x-csrf-token'], session.csrfToken)) {
      throw new DomainError(403, 'invalid_csrf', 'Sessione non valida. Ricarica la pagina e riprova.');
    }
  }

  /**
   * The private access link (ADMIN_BOOTSTRAP_TOKEN, with an expiry) works once.
   * Without an owner it activates the agenda; with an owner it sets a new
   * password and closes every other session (forgotten password).
   */
  async function setup(body) {
    const usedMessage = 'Questo link è già stato usato. Accedi con email e password oppure chiedi un nuovo link di accesso.';
    const expiry = typeof config.bootstrapExpiresAt === 'number' ? config.bootstrapExpiresAt : Date.parse(config.bootstrapExpiresAt || '');
    if (!config.bootstrapToken || !Number.isFinite(expiry) || expiry <= now()) {
      throw new DomainError(403, 'setup_expired', 'Il link di accesso è scaduto o non è disponibile. Chiedi un nuovo link.');
    }
    if (typeof body.token !== 'string' || body.token.length > 512 || !equalSecrets(body.token, config.bootstrapToken)) {
      throw new DomainError(403, 'invalid_setup_token', 'Il link di accesso non è valido. Controlla di averlo aperto per intero.');
    }
    if (linkUsed(config.bootstrapToken)) throw new DomainError(409, 'setup_completed', usedMessage);
    const lifetime = remember(body.remember);
    const email = normalizeEmail(body.email ?? ownerQuery.get()?.email ?? config.business.email);
    const passwordHash = await hashPassword(body.password);
    return store.transaction(() => {
      if (linkUsed(config.bootstrapToken)) throw new DomainError(409, 'setup_completed', usedMessage);
      if (expiry <= now()) throw new DomainError(403, 'setup_expired', 'Il link di accesso è scaduto. Chiedi un nuovo link.');
      const instant = now();
      if (ownerQuery.get()) {
        db.prepare('UPDATE owners SET email = ?, password_hash = ? WHERE id = 1').run(email, passwordHash);
        db.prepare('DELETE FROM sessions').run();
        db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)').run('owner_access_reset', '1', instant, '{}');
      } else {
        db.prepare('INSERT INTO owners (id, email, password_hash, created_at) VALUES (1, ?, ?, ?)').run(email, passwordHash, instant);
        db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)').run('owner_setup', '1', instant, '{}');
      }
      markLinkUsed(config.bootstrapToken);
      return createSession({ id: 1, email }, instant, lifetime);
    });
  }

  async function login(body) {
    const email = normalizeEmail(body.email);
    if (typeof body.password !== 'string' || body.password.length > 256) throw new DomainError(401, 'invalid_credentials', 'Email o password non corrette.');
    const lifetime = remember(body.remember);
    const owner = ownerQuery.get();
    // Execute the password derivation even for an unknown email.
    dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
    const matches = await verifyPassword(body.password, owner?.password_hash ?? await dummyHash);
    if (!owner || !equalSecrets(email, owner.email) || !matches) throw new DomainError(401, 'invalid_credentials', 'Email o password non corrette.');
    return store.transaction(() => {
      const currentOwner = ownerQuery.get();
      if (!currentOwner || currentOwner.password_hash !== owner.password_hash || currentOwner.email !== owner.email) {
        throw new DomainError(401, 'invalid_credentials', 'Email o password non corrette.');
      }
      return createSession(currentOwner, now(), lifetime);
    });
  }

  function logout(request) {
    const session = getSession(request);
    if (session) {
      checkCsrf(request, session);
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(session.idHash);
    }
    return { cookie: cookie('', true) };
  }

  async function changePassword(request, body) {
    const session = requireSession(request);
    checkCsrf(request, session);
    const owner = await requireCurrentPassword(request, body.currentPassword);
    const passwordHash = await hashPassword(body.password);
    return store.transaction(() => {
      // A session revoked by another request cannot change the password.
      const currentSession = getSession(request);
      const currentOwner = ownerQuery.get();
      if (!currentSession || currentSession.idHash !== session.idHash ||
        currentOwner?.password_hash !== owner.password_hash || currentOwner?.email !== owner.email) {
        throw new DomainError(401, 'authentication_required', 'Accedi di nuovo per modificare la password.');
      }
      const instant = now();
      db.prepare('UPDATE owners SET password_hash = ? WHERE id = 1').run(passwordHash);
      db.prepare('DELETE FROM sessions').run();
      db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)').run('owner_password_changed', '1', instant, '{}');
      return createSession(owner, instant, currentSession.lifetime);
    });
  }

  async function requireCurrentPassword(request, password) {
    const session = requireSession(request);
    const owner = ownerQuery.get();
    if (!owner || !(await verifyPassword(password, owner.password_hash))) {
      throw new DomainError(400, 'invalid_current_password', 'La password attuale non è corretta.');
    }
    // Verification is asynchronous; reject a session or credential changed meanwhile.
    const currentSession = getSession(request);
    const currentOwner = ownerQuery.get();
    if (!currentSession || currentSession.idHash !== session.idHash || !currentOwner ||
      currentOwner.password_hash !== owner.password_hash || currentOwner.email !== owner.email) {
      throw new DomainError(401, 'authentication_required', 'Accedi di nuovo per continuare.');
    }
    return owner;
  }

  async function changeAccount(request, body) {
    const email = normalizeEmail(body.email);
    const owner = await requireCurrentPassword(request, body.currentPassword);
    return store.transaction(() => {
      const currentOwner = ownerQuery.get();
      const currentSession = getSession(request);
      if (!currentSession || currentOwner?.password_hash !== owner.password_hash || currentOwner?.email !== owner.email) {
        throw new DomainError(401, 'authentication_required', 'Accedi di nuovo per modificare il tuo account.');
      }
      const instant = now();
      db.prepare('UPDATE owners SET email = ? WHERE id = 1').run(email);
      db.prepare('DELETE FROM sessions').run();
      db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)')
        .run('owner_email_changed', '1', instant, '{}');
      return createSession({ ...owner, email }, instant, currentSession.lifetime);
    });
  }

  return { getSession, requireSession, checkCsrf, sessionShape, setup, login, logout, changePassword, requireCurrentPassword, changeAccount };
}
