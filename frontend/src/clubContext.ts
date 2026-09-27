// Multitenancy context: club slug, namespaced storage, central fetch.
// Pure module (no Alpine/DOM side effects at import) so it can be unit-tested.

export function clubSlugFromPath(pathname: string): string | null {
  try {
    // Accept mixed case in the URL, canonicalise to lowercase (slugs are created lowercase-only).
    // Anchored to a full path segment so "/club/UPPER CASE" does not prefix-match.
    const m = pathname.match(/^\/club\/([a-zA-Z0-9-]{3,50})(?:\/|$)/);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

let currentClubSlug: string | null = null;
export function initClubSlug(pathname: string): string | null {
  currentClubSlug = clubSlugFromPath(pathname);
  return currentClubSlug;
}
export function getClubSlug(): string | null { return currentClubSlug; }
export function setClubSlug(s: string | null) { currentClubSlug = s ? s.toLowerCase() : null; }

function tokenKey(slug: string | null): string { return slug ? "token_" + slug : "token"; }
function intentKey(slug: string | null): string { return slug ? "pending_booking_intent_" + slug : "pending_booking_intent"; }

export function storedToken(): string | null {
  const slug = getClubSlug();
  if (!slug) return localStorage.getItem("token");
  return localStorage.getItem("token_" + slug) || localStorage.getItem("token");
}
export function storeToken(t: string) {
  const slug = getClubSlug();
  localStorage.setItem(slug ? "token_" + slug : "token", t);
  if (slug) localStorage.removeItem("token"); // never keep a club-less copy
}
export function clearToken() {
  const slug = getClubSlug();
  if (slug) localStorage.removeItem("token_" + slug);
  localStorage.removeItem("token");
}
export function storedIntent(): string | null {
  const slug = getClubSlug();
  if (!slug) return localStorage.getItem("pending_booking_intent");
  return localStorage.getItem("pending_booking_intent_" + slug) || localStorage.getItem("pending_booking_intent");
}
export function storeIntent(v: string) { localStorage.setItem(intentKey(getClubSlug()), v); }
export function clearIntent() {
  const slug = getClubSlug();
  if (slug) localStorage.removeItem("pending_booking_intent_" + slug);
  localStorage.removeItem("pending_booking_intent");
}

/** Central fetch: attaches X-Club-Slug + Authorization (namespaced token).
 *  Call-site "Bearer null" placeholders (legacy global reads) are replaced. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as any) || {}) };
  const slug = getClubSlug();
  if (slug && !headers["X-Club-Slug"]) headers["X-Club-Slug"] = slug;
  const auth = headers["Authorization"] || headers["authorization"];
  if (!auth || /Bearer\s+(null|undefined|)$/.test(String(auth))) {
    const tok = storedToken();
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    else { delete headers["Authorization"]; delete headers["authorization"]; }
  }
  return fetch(input, { ...init, headers });
}

export function isPlatformPath(pathname: string): boolean {
  return pathname === "/platform" || pathname.startsWith("/platform/");
}

/** Platform fetch: superadmin token, never a club slug. */
export async function platformFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as any) || {}) };
  const tok = localStorage.getItem("platform_token");
  if (tok && !headers["Authorization"]) headers["Authorization"] = `Bearer ${tok}`;
  return fetch(input, { ...init, headers });
}
