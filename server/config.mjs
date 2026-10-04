import path from 'node:path';
import { site } from '../src/data/site.ts';

export function createConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve essere una porta TCP valida.');
  }
  const production = env.NODE_ENV === 'production';
  if (production && !env.DATA_DIR) {
    throw new Error('Configurare DATA_DIR sul volume persistente prima di avviare l’agenda.');
  }
  const rawOrigin = env.APP_ORIGIN || env.SITE_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://127.0.0.1:${port}`);
  const origin = new URL(rawOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username ||
    origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
    (production && origin.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN deve essere l’origine del sito, HTTPS in produzione.');
  }
  const bootstrapToken = env.ADMIN_BOOTSTRAP_TOKEN || '';
  const bootstrapExpiresAt = env.ADMIN_BOOTSTRAP_EXPIRES_AT || '';
  if (bootstrapToken && (bootstrapToken.length < 32 ||
      !Number.isFinite(Date.parse(bootstrapExpiresAt)))) {
    throw new Error('Il collegamento di attivazione richiede un token forte e una scadenza valida.');
  }
  const graphVersion = env.WHATSAPP_GRAPH_VERSION || 'v26.0';
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error('WHATSAPP_GRAPH_VERSION non valida.');
  }
  return {
    port,
    host: env.HOST || '0.0.0.0',
    origin: origin.origin,
    production,
    trustProxy: env.RAILWAY_PROJECT_ID && env.RAILWAY_ENVIRONMENT_ID ? 'railway' : false,
    dataDir: path.resolve(env.DATA_DIR || '.data'),
    staticDir: path.resolve('dist'),
    business: site,
    bootstrapToken,
    bootstrapExpiresAt,
    whatsappConfigKey: env.WHATSAPP_CONFIG_KEY || '',
    whatsapp: {
      accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      templateName: env.WHATSAPP_TEMPLATE_NAME || '',
      templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE || 'it',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      graphVersion,
    },
  };
}
