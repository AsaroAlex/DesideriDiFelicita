/** Public storefront data, shared only for the lifetime of the current page. */
export interface PublicService {
  id: string;
  name: string;
  description: string;
  durationMinutes: number | null;
  priceCents: number | null;
  priceFrom: boolean;
  listed: boolean;
}

export interface PublicOpeningHour {
  day: string;
  label: string;
  ranges: { opens: string; closes: string }[];
}

export interface PublicConfig {
  catalog: PublicService[] | null;
  openingHours: PublicOpeningHour[] | null;
}

/** Matches the IDs assigned to the confirmed seed services by server/db.mjs. */
export function seedServiceId(service: { id?: string; name: string }, index: number): string {
  if (service.id) return service.id;
  const slug = service.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `servizio-${index + 1}`;
}

function normalizeCatalog(value: unknown): PublicService[] | null {
  if (!Array.isArray(value)) return null;
  const result: PublicService[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()
      || typeof item.name !== 'string' || !item.name.trim() || typeof item.listed !== 'boolean'
      || ids.has(item.id)) return null;
    ids.add(item.id);
    result.push({
      id: item.id,
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      durationMinutes: Number.isInteger(item.durationMinutes) && item.durationMinutes > 0
        ? item.durationMinutes : null,
      priceCents: Number.isSafeInteger(item.priceCents) && item.priceCents >= 0 ? item.priceCents : null,
      priceFrom: item.priceFrom === true,
      listed: item.listed,
    });
  }
  return result;
}

function normalizeHours(value: unknown): PublicOpeningHour[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const weekdays = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const result: PublicOpeningHour[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !weekdays.delete(entry.day)
      || typeof entry.label !== 'string' || !Array.isArray(entry.ranges)) return null;
    const ranges: PublicOpeningHour['ranges'] = [];
    for (const range of entry.ranges) {
      if (!range || typeof range !== 'object' || typeof range.opens !== 'string'
        || typeof range.closes !== 'string' || !time.test(range.opens) || !time.test(range.closes)
        || range.closes <= range.opens) return null;
      ranges.push({ opens: range.opens, closes: range.closes });
    }
    result.push({ day: entry.day, label: entry.label, ranges });
  }
  return result;
}

let generation = 0;
const requests = new Map<string, { controller: AbortController; promise: Promise<PublicConfig | null> }>();

if (typeof document !== 'undefined') {
  document.addEventListener('astro:before-swap', () => {
    generation++;
    requests.forEach(({ controller }) => controller.abort());
    requests.clear();
  });
}

/** No persisted cache or credentials; navigation aborts every old page request. */
export function getPublicConfig(url: string): Promise<PublicConfig | null> {
  const existing = requests.get(url);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const requestGeneration = generation;
  const promise = (async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
      const config = await response.json();
      if (controller.signal.aborted || requestGeneration !== generation
        || !config || typeof config !== 'object' || Array.isArray(config)) return null;
      return { catalog: normalizeCatalog(config.catalog), openingHours: normalizeHours(config.openingHours) };
    } catch {
      return null;
    }
  })();
  requests.set(url, { controller, promise });
  return promise;
}
