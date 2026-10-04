export class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
  }
}

export function fail(code, message, status = 400) {
  throw new DomainError(status, code, message);
}

export function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_input', 'I dati inviati non sono validi.');
  }
  return value;
}

export function cleanText(value, field, { min = 1, max = 100 } = {}) {
  if (typeof value !== 'string') fail('invalid_input', `${field}: inserisci un testo valido.`);
  const result = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (result.length < min || result.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('invalid_input', `${field}: usa da ${min} a ${max} caratteri.`);
  }
  return result;
}

export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+\d ()\-.]+$/.test(value)) {
    fail('invalid_phone', 'Inserisci il telefono con prefisso internazionale, per esempio +39.');
  }
  let phone = value.trim().replace(/[ ()\-.]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    fail('invalid_phone', 'Inserisci il telefono con prefisso internazionale, per esempio +39.');
  }
  return phone;
}

export function integer(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('invalid_input', `${field}: inserisci un numero intero da ${min} a ${max}.`);
  }
  return value;
}

export function boolean(value, field) {
  if (typeof value !== 'boolean') fail('invalid_input', `${field}: scegli sì o no.`);
  return value;
}

export function duration(value) {
  return integer(value, 'Durata in minuti', 5, 480);
}
