type Access = { csrfToken: string; email: string };

/** Private panels share the owner's existing cookie and never save it in browser storage. */
export function mountAdminPanel(selector: string, panel: string, ready: (context: {
  root: HTMLElement;
  api: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  on: (target: EventTarget, event: string, handler: EventListener) => void;
  isSignedIn: () => boolean;
}) => { load: () => Promise<void>; clear: () => void }) {
  let activeRoot: HTMLElement | null = null;
  let dispose: (() => void) | undefined;
  function init() {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root || root === activeRoot) return;
    dispose?.(); activeRoot = root;
    const life = new AbortController();
    let access: Access | null = null;
    const on = (target: EventTarget, event: string, handler: EventListener) => target.addEventListener(event, handler, { signal: life.signal });
    async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      if (!access) throw new Error('Accedi al portale per continuare.');
      const requestAccess = access;
      const response = await fetch(path, { method, credentials: 'same-origin', signal: life.signal,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': requestAccess.csrfToken } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json().catch(() => null);
      // A response from before logout or account rotation cannot affect the new access.
      if (access !== requestAccess || life.signal.aborted) throw new DOMException('Operazione superata.', 'AbortError');
      if (!response.ok) {
        if (response.status === 401) document.dispatchEvent(new CustomEvent('agenda:authentication-expired'));
        throw new Error(value?.error?.message || 'Operazione non riuscita. Riprova tra poco.');
      }
      if (!access || life.signal.aborted) throw new Error('Accedi al portale per continuare.');
      return value as T;
    }
    const actions = ready({ root, api, on, isSignedIn: () => Boolean(access) && !life.signal.aborted });
    on(document, 'agenda:authenticated', event => {
      access = (event as CustomEvent<Access>).detail;
      actions.clear();
    });
    on(document, 'agenda:logout', () => { access = null; actions.clear(); });
    on(document, 'agenda:panel', event => {
      if (access && (event as CustomEvent<{panel: string}>).detail?.panel === panel) void actions.load();
    });
    dispose = () => { life.abort(); access = null; actions.clear(); activeRoot = null; };
  }
  document.addEventListener('astro:before-swap', () => { dispose?.(); dispose = undefined; });
  document.addEventListener('astro:page-load', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
}
