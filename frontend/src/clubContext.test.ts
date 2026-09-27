import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  clubSlugFromPath, initClubSlug, getClubSlug, setClubSlug,
  storedToken, storeToken, clearToken, storedIntent, storeIntent, clearIntent,
  apiFetch, isPlatformPath, platformFetch,
} from "./clubContext.js";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    _map: m,
  };
}

let store = memoryStorage();
let seen: { input: string; headers: any } | null = null;

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  seen = null;
  vi.stubGlobal("fetch", (async (input: string, init: any) => {
    seen = { input, headers: init?.headers || {} };
    return { ok: true };
  }) as any);
  setClubSlug(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clubSlugFromPath", () => {
  it("parses /c/:slug", () => {
    expect(clubSlugFromPath("/c/green-village/")).toBe("green-village");
    expect(clubSlugFromPath("/c/Demo-AB12")).toBe("demo-ab12");
  });
  it("rejects bare, platform and bad slugs", () => {
    expect(clubSlugFromPath("/")).toBeNull();
    expect(clubSlugFromPath("/platform")).toBeNull();
    expect(clubSlugFromPath("/c/ab")).toBeNull();
    expect(clubSlugFromPath("/c/UPPER CASE")).toBeNull();
  });
});

describe("namespaced storage (no self-recursion)", () => {
  it("round-trips token + intent per slug", () => {
    setClubSlug("green-village");
    storeToken("tok123");
    storeIntent(`{"a":1}`);
    expect(storedToken()).toBe("tok123");
    expect(storedIntent()).toBe(`{"a":1}`);
    expect(store._map.get("token_green-village")).toBe("tok123");
    clearToken();
    clearIntent();
    expect(storedToken()).toBeNull();
    expect(storedIntent()).toBeNull();
  });
  it("falls back to the legacy global key", () => {
    setClubSlug("green-village");
    store._map.set("token", "legacy");
    expect(storedToken()).toBe("legacy");
  });
  it("storeToken drops the club-less copy", () => {
    setClubSlug("green-village");
    store._map.set("token", "legacy");
    storeToken("fresh");
    expect(store._map.get("token")).toBeUndefined();
    expect(storedToken()).toBe("fresh");
  });
  it("initClubSlug wires the module state", () => {
    initClubSlug("/c/demo/");
    expect(getClubSlug()).toBe("demo");
  });
});

describe("apiFetch", () => {
  it("attaches X-Club-Slug + Authorization", async () => {
    setClubSlug("green-village");
    storeToken("tok123");
    await apiFetch("/api/courts");
    expect(seen!.headers["X-Club-Slug"]).toBe("green-village");
    expect(seen!.headers["Authorization"]).toBe("Bearer tok123");
  });
  it("sanitizes legacy 'Bearer null' placeholders", async () => {
    setClubSlug("green-village");
    storeToken("tok123");
    await apiFetch("/api/courts", { headers: { Authorization: "Bearer null" } as any });
    expect(seen!.headers["Authorization"]).toBe("Bearer tok123");
  });
  it("drops empty auth instead of sending 'Bearer null'", async () => {
    setClubSlug("green-village");
    await apiFetch("/api/courts", { headers: { Authorization: "Bearer null" } as any });
    expect("Authorization" in seen!.headers).toBe(false);
  });
  it("keeps an explicit valid token", async () => {
    setClubSlug("green-village");
    storeToken("tok123");
    await apiFetch("/api/courts", { headers: { Authorization: "Bearer other" } as any });
    expect(seen!.headers["Authorization"]).toBe("Bearer other");
  });
});

describe("platform", () => {
  it("detects /platform paths", () => {
    expect(isPlatformPath("/platform")).toBe(true);
    expect(isPlatformPath("/platform/clubs")).toBe(true);
    expect(isPlatformPath("/c/demo/")).toBe(false);
  });
  it("platformFetch never sends a club slug", async () => {
    setClubSlug("green-village");
    store._map.set("platform_token", "ptok");
    await platformFetch("/api/platform/clubs");
    expect(seen!.headers["X-Club-Slug"]).toBeUndefined();
    expect(seen!.headers["Authorization"]).toBe("Bearer ptok");
  });
});
