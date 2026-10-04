/** The salon has one optional external service: the Google Maps embed. */
export type ConsentChoice = {
  version: 1;
  maps: boolean;
  decidedAt: number;
  expiresAt: number;
};

const STORAGE_KEY = 'desideri-di-felicita:consent:v1';
const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
export const CONSENT_CHANGE_EVENT = 'ddf:consent-change';
export const CONSENT_OPEN_EVENT = 'ddf:consent-open';
let memoryChoice: ConsentChoice | null = null;
let useMemoryChoice = false;
let watchingStorage = false;

function parseChoice(raw: string | null): ConsentChoice | null {
  if (!raw) return null;
  try {
    const choice = JSON.parse(raw);
    const now = Date.now();
    if (choice?.version !== 1 || typeof choice.maps !== 'boolean'
      || !Number.isFinite(choice.decidedAt) || !Number.isFinite(choice.expiresAt)
      || choice.decidedAt > now || choice.expiresAt <= now
      || choice.expiresAt > choice.decidedAt + MAX_AGE) return null;
    return choice;
  } catch {
    return null;
  }
}

export function getConsent(): ConsentChoice | null {
  if (useMemoryChoice) {
    if (memoryChoice && memoryChoice.expiresAt <= Date.now()) memoryChoice = null;
    return memoryChoice;
  }
  try {
    memoryChoice = parseChoice(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    if (memoryChoice && memoryChoice.expiresAt <= Date.now()) memoryChoice = null;
  }
  return memoryChoice;
}

export function saveConsent(maps: boolean): ConsentChoice {
  const now = Date.now();
  const choice: ConsentChoice = { version: 1, maps, decidedAt: now, expiresAt: now + MAX_AGE };
  memoryChoice = choice;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    useMemoryChoice = false;
  } catch {
    // A blocked storage still allows the visitor to choose for this page visit.
    useMemoryChoice = true;
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
  return choice;
}

export function openConsentPreferences(trigger?: HTMLElement): void {
  window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT, { detail: { trigger } }));
}

export function watchConsentStorage(): void {
  if (watchingStorage) return;
  watchingStorage = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    useMemoryChoice = false;
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: getConsent() }));
  });
}
