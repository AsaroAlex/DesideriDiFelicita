import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import serveHandler from 'serve-handler';
import { createStore } from './db.mjs';
import { DomainError } from './domain.mjs';
import { createAuth } from './auth.mjs';
import { createReminderRunner } from './reminders.mjs';

const BODY_LIMIT = 32 * 1024;
const JSON_TYPE = 'application/json; charset=utf-8';
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createRateLimiter({ now = Date.now, maxEntries = 5000 } = {}) {
  const entries = new Map();
  return function check(key, limit, windowMs) {
    const instant = now();
    let entry = entries.get(key);
    if (!entry || entry.until <= instant) {
      if (entries.size >= maxEntries) {
        for (const [storedKey, stored] of entries) if (stored.until <= instant) entries.delete(storedKey);
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      }
      entry = { count: 0, until: instant + windowMs };
      entries.set(key, entry);
    }
    if (entry.count >= limit) {
      const error = new DomainError(429, 'rate_limited', 'Troppe richieste. Attendi qualche minuto e riprova.');
      error.retryAfter = Math.max(1, Math.ceil((entry.until - instant) / 1000));
      throw error;
    }
    entry.count += 1;
  };
}

function rawBody(request) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > BODY_LIMIT) {
    request.resume();
    return Promise.reject(new DomainError(413, 'body_too_large', 'La richiesta è troppo grande.'));
  }
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let bytes = 0;
    let completed = false;
    const clean = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAbort);
    };
    const fail = (error) => {
      if (completed) return;
      completed = true;
      clean();
      request.resume();
      reject(error);
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) return fail(new DomainError(413, 'body_too_large', 'La richiesta è troppo grande.'));
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (completed) return;
      completed = true;
      clean();
      resolveBody(Buffer.concat(chunks));
    };
    const onError = () => fail(new DomainError(400, 'invalid_body', 'La richiesta non è completa.'));
    const onAbort = () => fail(new DomainError(400, 'invalid_body', 'La richiesta non è completa.'));
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAbort);
  });
}

async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw new DomainError(415, 'json_required', 'Invia la richiesta in formato JSON.');
  }
  const raw = await rawBody(request);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { throw new DomainError(400, 'invalid_json', 'La richiesta non è valida.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError(400, 'invalid_json', 'La richiesta non è valida.');
  return body;
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', JSON_TYPE);
  response.end(JSON.stringify(value));
}

function checkOrigin(request, origin) {
  if (request.headers.origin !== origin) throw new DomainError(403, 'invalid_origin', 'La richiesta deve provenire da questo sito.');
  const site = request.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new DomainError(403, 'invalid_origin', 'La richiesta deve provenire da questo sito.');
}

function resourceId(value) {
  let id;
  try { id = decodeURIComponent(value); } catch { throw new DomainError(400, 'invalid_id', 'Identificativo non valido.'); }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new DomainError(400, 'invalid_id', 'Identificativo non valido.');
  return id;
}

function csvCell(value) {
  let text = String(value ?? '').replace(/\0/g, '');
  // Prefix spreadsheet formulas, including international phone numbers.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function appointmentsCsv(appointments) {
  const headers = ['Riferimento', 'Stato', 'Servizio', 'Data', 'Ora', 'Durata minuti', 'Cliente', 'Telefono', 'Consenso promemoria'];
  const rows = appointments.map((item) => [item.reference, item.status, item.title, item.date, item.time, item.durationMinutes, item.name, item.phone, item.reminderConsent ? 'Sì' : 'No']);
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function securityHeaders(response, { privatePage, https }) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-src https://www.google.com https://maps.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (https) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (privatePage) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
}

export function createApp({ config, store: suppliedStore, reminderRunner: suppliedRunner, now = Date.now }) {
  if (!config || !config.origin) throw new Error('Application origin is required.');
  const origin = new URL(config.origin).origin;
  const store = suppliedStore || createStore({ dataDir: config.dataDir, business: config.business, now });
  const reminderRunner = suppliedRunner || createReminderRunner({ store, config, now });
  const auth = createAuth({ store, config: { ...config, origin }, now });
  const limit = createRateLimiter({ now });
  const dist = resolve(config.staticDir || config.distDir || 'dist');
  let servingConfig = { directoryListing: false };
  try { servingConfig = { ...JSON.parse(readFileSync(resolve('serve.json'), 'utf8')), directoryListing: false }; }
  catch { /* Safe default if a custom static configuration is absent. */ }

  const automationStatus = () => {
    const status = reminderRunner.getStatus();
    // Select only the documented public-to-owner status fields.
    return {
      configured: status.configured === true,
      missing: Array.isArray(status.missing) ? status.missing.filter((name) => /^WHATSAPP_[A-Z_]+$/.test(name)) : [],
      dailyLimit: status.dailyLimit,
      monthlyLimit: status.monthlyLimit,
      sentThisMonth: status.sentThisMonth,
    };
  };
  const sessionResult = (session) => ({ ...auth.sessionShape(session), ...(session ? { whatsappConfigured: automationStatus().configured } : {}) });
  const clientIp = (request) => {
    // Railway's edge supplies X-Real-IP. X-Forwarded-For is not trusted.
    if (config.trustProxy === 'railway') {
      const forwarded = request.headers['x-real-ip'];
      if (typeof forwarded === 'string' && isIP(forwarded.trim())) return forwarded.trim();
    }
    return request.socket.remoteAddress || 'unknown';
  };

  async function routeApi(request, response, url) {
    response.setHeader('Cache-Control', 'no-store');
    const method = request.method;
    const path = url.pathname;
    const ip = clientIp(request);
    if (path === '/api/whatsapp/webhook' && (method === 'GET' || method === 'POST')) {
      limit(`webhook:${ip}`, 300, 60_000);
      const result = await reminderRunner.handleWebhook({ method, query: url.searchParams, rawBody: method === 'POST' ? await rawBody(request) : Buffer.alloc(0), signature: request.headers['x-hub-signature-256'] });
      response.statusCode = result.status;
      response.setHeader('Content-Type', result.contentType || (typeof result.body === 'string' ? 'text/plain; charset=utf-8' : JSON_TYPE));
      response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
      return;
    }
    if (MUTATIONS.has(method)) checkOrigin(request, origin);
    if (method === 'GET' && path === '/api/health') return json(response, 200, { ok: true });
    if (method === 'GET' && path === '/api/public/config') {
      limit(`public-config:${ip}`, 100, 60_000);
      return json(response, 200, store.getPublicConfig(now()));
    }
    if (method === 'GET' && path === '/api/public/availability') {
      limit(`availability:${ip}`, 100, 60_000);
      return json(response, 200, store.getAvailability({ serviceId: url.searchParams.get('serviceId'), date: url.searchParams.get('date') }, now()));
    }
    if (method === 'GET' && path === '/api/public/request-availability') {
      limit(`availability:${ip}`, 100, 60_000);
      return json(response, 200, store.getRequestAvailability({ serviceId: url.searchParams.get('serviceId'), date: url.searchParams.get('date') }, now()));
    }
    if (method === 'POST' && (path === '/api/public/bookings' || path === '/api/public/requests')) {
      // Both customer flows share one budget, so alternating endpoints cannot bypass it.
      limit('bookings:global', 60, 3_600_000);
      limit(`bookings:${ip}`, 10, 3_600_000);
      const body = await jsonBody(request);
      return json(response, 201, path.endsWith('/requests') ? store.createPublicRequest(body, now()) : store.createPublicBooking(body, now()));
    }
    if (method === 'GET' && path === '/api/auth/session') return json(response, 200, sessionResult(auth.getSession(request)));
    if (method === 'POST' && (path === '/api/auth/setup' || path === '/api/auth/login')) {
      limit('auth:global', 100, 900_000);
      limit(`auth:${ip}`, 5, 900_000);
      const result = await auth[path.endsWith('/setup') ? 'setup' : 'login'](await jsonBody(request));
      response.setHeader('Set-Cookie', result.cookie);
      return json(response, path.endsWith('/setup') ? 201 : 200, sessionResult(result.session));
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      const result = auth.logout(request);
      response.setHeader('Set-Cookie', result.cookie);
      return json(response, 200, { ok: true });
    }
    if (path.startsWith('/api/admin/')) {
      const session = auth.requireSession(request);
      if (MUTATIONS.has(method)) auth.checkCsrf(request, session);
      if (method === 'POST' && path === '/api/admin/password') {
        limit(`password:${ip}`, 5, 900_000);
        const result = await auth.changePassword(request, await jsonBody(request));
        response.setHeader('Set-Cookie', result.cookie);
        return json(response, 200, sessionResult(result.session));
      }
      if (method === 'GET' && path === '/api/admin/appointments') return json(response, 200, { items: store.listAppointments({ from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined }, now()) });
      if (method === 'POST' && path === '/api/admin/appointments') return json(response, 201, store.createAdminAppointment(await jsonBody(request), now()));
      const appointmentMatch = path.match(/^\/api\/admin\/appointments\/([^/]+)$/);
      if (method === 'PATCH' && appointmentMatch) return json(response, 200, store.updateAppointment(resourceId(appointmentMatch[1]), await jsonBody(request), now()));
      if (method === 'GET' && path === '/api/admin/requests') {
        const count = url.searchParams.get('limit') || '100';
        if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 500) throw new DomainError(400, 'invalid_limit', 'Il numero di richieste visualizzate non è valido.');
        const status = url.searchParams.get('status') || 'pending';
        if (!['pending', 'confirmed', 'declined'].includes(status)) throw new DomainError(400, 'invalid_status', 'Lo stato delle richieste non è valido.');
        return json(response, 200, { items: store.listRequests({ status, limit: Number(count) }) });
      }
      const requestMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/(confirm|decline)$/);
      if (method === 'POST' && requestMatch) {
        const id = resourceId(requestMatch[1]);
        const body = await jsonBody(request);
        if (requestMatch[2] === 'confirm') return json(response, 201, store.confirmRequest(id, body, now()));
        return json(response, 200, store.declineRequest(id, now()));
      }
      if (method === 'GET' && path === '/api/admin/services') return json(response, 200, { items: store.listServices() });
      const serviceMatch = path.match(/^\/api\/admin\/services\/([^/]+)$/);
      if (method === 'PATCH' && serviceMatch) return json(response, 200, store.updateService(resourceId(serviceMatch[1]), await jsonBody(request), now()));
      if (method === 'GET' && path === '/api/admin/settings') return json(response, 200, store.getSettings());
      if (method === 'PATCH' && path === '/api/admin/settings') return json(response, 200, store.updateSettings(await jsonBody(request), now()));
      if (method === 'GET' && path === '/api/admin/reminders') {
        const count = url.searchParams.get('limit') || '100';
        if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 500) throw new DomainError(400, 'invalid_limit', 'Il numero di promemoria richiesti non è valido.');
        return json(response, 200, { items: store.listReminders({ limit: Number(count) }) });
      }
      if (method === 'GET' && path === '/api/admin/stats') return json(response, 200, store.getStats(now()));
      if (method === 'GET' && path === '/api/admin/automation') return json(response, 200, automationStatus());
      if (method === 'GET' && path === '/api/admin/export.csv') {
        const items = store.listAppointments({ from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined }, now());
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="appuntamenti.csv"');
        return response.end(appointmentsCsv(items));
      }
    }
    throw new DomainError(404, 'not_found', 'Risorsa non trovata.');
  }

  async function handler(request, response) {
    let url;
    try {
      url = new URL(request.url, origin);
      const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
      let normalizedPath = url.pathname;
      try { normalizedPath = decodeURIComponent(normalizedPath).replace(/\/+/g, '/'); } catch { /* Leave malformed escapes for the static handler to reject. */ }
      const privatePage = api || /^\/agenda(?:\/|\.html|$)/.test(normalizedPath);
      securityHeaders(response, { privatePage, https: origin.startsWith('https:') });
      if (api) return await routeApi(request, response, url);
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new DomainError(405, 'method_not_allowed', 'Metodo non consentito.');
      const options = { ...servingConfig, public: dist };
      if (privatePage) {
        // Static header rules must not override the private agenda policy.
        options.headers = [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
      }
      await serveHandler(request, response, options);
    } catch (error) {
      if (response.writableEnded || response.destroyed) return;
      response.setHeader('Cache-Control', 'no-store');
      if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      const status = error instanceof DomainError ? error.status : 500;
      const code = error instanceof DomainError ? error.code : 'internal_error';
      const message = error instanceof DomainError ? error.message : 'Si è verificato un problema. Riprova tra poco.';
      // Never log request bodies, customer details, passwords, tokens, or provider errors.
      if (status === 500) console.error('Application request failed.');
      json(response, status, { error: { code, message } });
    }
  }

  const server = createServer({ maxHeaderSize: 16 * 1024 }, handler);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  let closed = false;
  return {
    server, handler, store,
    async start() {
      await new Promise((resolveStart, reject) => {
        const failed = (error) => reject(error);
        server.once('error', failed);
        server.listen(config.port ?? 3000, config.host || '0.0.0.0', () => {
          server.off('error', failed);
          resolveStart();
        });
      });
      reminderRunner.start();
      return server.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      let drained = Promise.resolve();
      if (server.listening) {
        const force = setTimeout(() => server.closeAllConnections(), 10_000);
        force.unref();
        drained = new Promise((resolveClose) => server.close(resolveClose)).finally(() => clearTimeout(force));
      }
      // Stop accepting requests immediately, then drain HTTP and reminder work.
      await Promise.all([drained, reminderRunner.stop()]);
      store.close();
    },
  };
}
