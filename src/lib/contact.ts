/**
 * Helper per i contatti, derivati dai dati centralizzati in site.ts.
 * Costruiscono link tel: e wa.me a partire da numeri scritti "in chiaro"
 * (con spazi e prefisso +39).
 */

/** Tiene solo le cifre (per wa.me) mantenendo il prefisso internazionale. */
export function digitsOnly(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/** Link telefonico: tel:+393500125159 */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return `tel:${cleaned}`;
}

/**
 * Link WhatsApp wa.me con messaggio precompilato opzionale.
 * Es: https://wa.me/393500125159?text=Ciao...
 */
export function whatsappHref(phone: string, message?: string): string {
  const number = digitsOnly(phone);
  const base = `https://wa.me/${number}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Messaggi di consulenza: distinti dalla richiesta inviata con il calendario. */
export function salonQuestionMessage(ownerName: string, subject?: 'ricci' | 'galleria'): string {
  const firstName = ownerName.trim().split(/\s+/)[0];
  const greeting = `Ciao ${firstName},`;
  if (subject === 'ricci') return `${greeting} vorrei un consiglio per prendermi cura dei miei ricci.`;
  if (subject === 'galleria') return `${greeting} ho visto un look nella galleria e vorrei capire se è adatto ai miei capelli. Posso mandarti una foto?`;
  return `${greeting} vorrei un consiglio per i miei capelli.`;
}
