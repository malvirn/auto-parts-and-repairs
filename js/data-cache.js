// Lightweight stale-while-revalidate cache over sessionStorage.
//
// Problem it solves: this is a classic multi-page app, so every navigation
// is a full page load that starts from a blank screen until that page's own
// Supabase queries come back. hydrate() makes a page render instantly from
// whatever it (or the sign-in screen's prefetch) already loaded this
// session, then quietly re-fetches in the background and re-renders if
// anything changed — so moving between pages feels instant without ever
// showing stale data for more than a moment.

const PREFIX = "apr:cache:";

export function cacheSet(key, data) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), data }));
  } catch (e) {
    // Storage full/unavailable (private browsing, etc.) — fine, just skip caching.
  }
}

export function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw).data;
  } catch (e) {
    return null;
  }
}

// render(data) must be safe to call twice in a row (once with cached data,
// once with fresh data) — it should fully replace whatever it draws rather
// than appending to it.
//
// If the background refresh fails (network hiccup, etc.) and there was a
// cached render to fall back on, the failure is logged but swallowed rather
// than being thrown — a good cached screen should never be replaced by an
// error message just because the quiet refresh behind it didn't land. It's
// only re-thrown when there was nothing cached to show in the first place.
export async function hydrate(key, fetcher, render) {
  const cached = cacheGet(key);
  if (cached) render(cached);
  try {
    const fresh = await fetcher();
    cacheSet(key, fresh);
    render(fresh);
    return fresh;
  } catch (error) {
    if (cached) { console.error(`Background refresh failed for "${key}":`, error); return cached; }
    throw error;
  }
}
