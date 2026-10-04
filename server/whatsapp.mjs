/** Official WhatsApp Cloud API adapter. No WhatsApp Web automation or real sends in tests. */
export function whatsappConfiguration(whatsapp = {}) {
  const missing = [];
  if (!whatsapp.accessToken?.trim()) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!/^\d+$/.test(whatsapp.phoneNumberId || '')) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!/^[a-z0-9_]+$/.test(whatsapp.templateName || '')) missing.push('WHATSAPP_TEMPLATE_NAME');
  if (!/^v\d+\.\d+$/.test(whatsapp.graphVersion || '')) missing.push('WHATSAPP_GRAPH_VERSION');
  return { configured: missing.length === 0, missing };
}

function safeErrorCode(payload, fallback) {
  const code = payload?.error?.code;
  return Number.isSafeInteger(code) ? `META_${code}` : fallback;
}

/**
 * A rejected 429 is the only automatic retry. Timeouts, connection failures,
 * 5xx responses and successful responses without an ID can have been accepted
 * by Meta already; they require review rather than a second paid message.
 */
export async function sendAppointmentReminder({ whatsapp, appointment, fetchImpl = fetch, now = Date.now() }) {
  const configuration = whatsappConfiguration(whatsapp);
  if (!configuration.configured) return { status: 'unconfigured' };
  const controller = new AbortController();
  const timeoutMs = Math.min(30_000, Math.max(1, whatsapp.timeoutMs ?? 25_000));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('WhatsApp request timeout'));
    }, timeoutMs);
  });
  const date = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(appointment.start_at);
  const time = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(appointment.start_at);
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: appointment.phone.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: whatsapp.templateName,
      language: { code: whatsapp.templateLanguage || 'it' },
      components: [{
        type: 'body',
        parameters: [appointment.name, date, time].map((text) => ({ type: 'text', text })),
      }],
    },
  };

  try {
    // The timeout covers reading the body too: receiving response headers alone
    // does not establish whether Meta accepted the template.
    const operation = (async () => {
      const response = await fetchImpl(
        `https://graph.facebook.com/${whatsapp.graphVersion}/${whatsapp.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${whatsapp.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      if (response.status === 429) {
        const retryAfter = response.headers?.get?.('retry-after');
        const seconds = /^\d+$/.test(retryAfter || '')
          ? Number(retryAfter)
          : Math.ceil((Date.parse(retryAfter || '') - now) / 1000);
        return {
          status: 'retry', errorCode: safeErrorCode(payload, 'HTTP_429'),
          retryAfterMs: Number.isFinite(seconds) ? Math.min(900_000, Math.max(60_000, seconds * 1000)) : 60_000,
        };
      }
      if (response.status >= 500) return { status: 'needs_review', errorCode: `HTTP_${response.status}` };
      if (!response.ok) return { status: 'failed', errorCode: safeErrorCode(payload, `HTTP_${response.status}`) };
      const messageId = payload?.messages?.[0]?.id;
      if (typeof messageId !== 'string' || !messageId || messageId.length > 512) {
        return { status: 'needs_review', errorCode: 'MISSING_MESSAGE_ID' };
      }
      return { status: 'accepted', messageId };
    })();
    return await Promise.race([operation, timeout]);
  } catch {
    return { status: 'needs_review', errorCode: controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}
