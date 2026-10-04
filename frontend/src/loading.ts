// Global loading tracker: counter-based so parallel apiFetch calls overlap safely.
// Mirrors viklik's loading.ts intent (top bar + pill) but fixes the boolean
// isRequesting race with a pending count + subscriber notifications for Alpine.

type Listener = (pending: number) => void;

let pending = 0;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) {
    try { fn(pending); } catch { /* ignore subscriber errors */ }
  }
}

export function pendingCount(): number {
  return pending;
}

export function isLoading(): boolean {
  return pending > 0;
}

export function startLoading(): number {
  pending += 1;
  notify();
  return pending;
}

export function stopLoading(): number {
  pending = Math.max(0, pending - 1);
  notify();
  return pending;
}

export function resetLoading(): void {
  pending = 0;
  notify();
}

export function subscribeLoading(fn: Listener): () => void {
  listeners.add(fn);
  // Emit current state immediately so Alpine picks it up on init.
  try { fn(pending); } catch { /* ignore */ }
  return () => { listeners.delete(fn); };
}

/** Wrap any promise so the global indicator is active for its duration. */
export async function trackLoading<T>(promise: Promise<T>): Promise<T> {
  startLoading();
  try {
    return await promise;
  } finally {
    stopLoading();
  }
}
