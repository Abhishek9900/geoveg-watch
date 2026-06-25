"use client";

/**
 * Generates a random session id and keeps it in memory for the lifetime of the page.
 * Deliberately NOT persisted to localStorage/sessionStorage (per architecture: caching
 * is per-session/in-memory on the backend, and a fresh id per page load is fine since
 * the only cost of a "new" session is losing warm cache, not correctness).
 */
let cachedSessionId: string | null = null;

export function getSessionId(): string {
  if (!cachedSessionId) {
    cachedSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return cachedSessionId;
}
