// Personal ratings, custom lists and watch statistics (stored per profile,
// synced through cloud sync).
//   streambert_myRatings   { "<type>_<id>": { stars: 1-5, at, item } }
//   streambert_customLists { "<listId>": { id, name, createdAt, updatedAt, items: { "<type>_<id>": item } } }
//   streambert_watchStats  { devices: { "<deviceId>": { days: { "YYYY-MM-DD": secs }, titles: { "<type>_<id>": {secs,…} } } } }
// Watch time is kept per device so syncing devices never double-counts.
import { useEffect, useState } from "react";

export const K_RATINGS = "streambert_myRatings";
export const K_LISTS = "streambert_customLists";
export const K_STATS = "streambert_watchStats";
const EVT = "streambert:library-extras-changed";

const read = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVT, { detail: k }));
};

export const itemKey = (item) => `${item?.media_type || (item?.first_air_date ? "tv" : "movie")}_${item?.id}`;
/** what we keep of a title (enough to show a card and open it) */
export const slim = (item) => ({
  id: item.id,
  media_type: item.media_type || (item.first_air_date ? "tv" : "movie"),
  title: item.title || item.name || "",
  poster_path: item.poster_path || null,
  backdrop_path: item.backdrop_path || null,
  vote_average: item.vote_average ?? null,
  release_date: item.release_date || item.first_air_date || null,
});

// ── ratings ──────────────────────────────────────────────────────────────────
export const getRatings = () => read(K_RATINGS, {});
export const getMyRating = (item) => getRatings()[itemKey(item)]?.stars || 0;
export function setMyRating(item, stars) {
  const r = getRatings();
  const k = itemKey(item);
  if (!stars) delete r[k];
  else r[k] = { stars, at: Date.now(), item: slim(item) };
  write(K_RATINGS, r);
  import("./trakt.js").then((m) => m.traktRate(slim(item), stars)).catch(() => {});
}

// ── custom lists ─────────────────────────────────────────────────────────────
export const getLists = () => read(K_LISTS, {});
export function createList(name) {
  const lists = getLists();
  const id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  lists[id] = { id, name: String(name || "My list").slice(0, 40), createdAt: Date.now(), updatedAt: Date.now(), items: {} };
  write(K_LISTS, lists);
  return id;
}
export function renameList(id, name) {
  const lists = getLists();
  if (!lists[id]) return;
  lists[id] = { ...lists[id], name: String(name).slice(0, 40) || lists[id].name, updatedAt: Date.now() };
  write(K_LISTS, lists);
}
export function deleteList(id) {
  const lists = getLists();
  delete lists[id];
  write(K_LISTS, lists);
}
export function toggleInList(id, item) {
  const lists = getLists();
  const l = lists[id];
  if (!l) return;
  const k = itemKey(item);
  const items = { ...(l.items || {}) };
  if (items[k]) delete items[k];
  else items[k] = { ...slim(item), addedAt: Date.now() };
  lists[id] = { ...l, items, updatedAt: Date.now() };
  write(K_LISTS, lists);
}

// ── watch statistics ─────────────────────────────────────────────────────────
function deviceId() {
  let id = localStorage.getItem("__sb_device_id");
  if (!id) {
    id = "d" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("__sb_device_id", id);
  }
  return id;
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let pending = { secs: 0, title: null };
let flushTimer = null;
/** called about once a second while something plays (from playback.js) */
export function trackWatchSecond(info) {
  if (!info?.id || !info.media_type) return;
  const k = `${info.media_type}_${info.id}`;
  if (pending.key && pending.key !== k) flushStats();
  pending.key = k;
  pending.info = info;
  pending.secs += 1;
  if (!flushTimer) flushTimer = setTimeout(flushStats, 15000);
}
export function flushStats() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!pending.key || !pending.secs) return;
  const st = read(K_STATS, { devices: {} });
  const dev = (st.devices = st.devices || {})[deviceId()] || { days: {}, titles: {} };
  const d = today();
  dev.days[d] = (dev.days[d] || 0) + pending.secs;
  const t = dev.titles[pending.key] || { secs: 0 };
  dev.titles[pending.key] = {
    ...t,
    secs: t.secs + pending.secs,
    id: pending.info.id,
    media_type: pending.info.media_type,
    title: pending.info.title || t.title || "",
    poster_path: pending.info.poster_path || t.poster_path || null,
    genres: pending.info.genres?.length ? pending.info.genres : t.genres || [],
    lastAt: Date.now(),
  };
  st.devices[deviceId()] = dev;
  pending = { secs: 0, title: null };
  write(K_STATS, st);
}

/** totals across all devices */
export function getStats() {
  const st = read(K_STATS, { devices: {} });
  const days = {}, titles = {};
  for (const dev of Object.values(st.devices || {})) {
    for (const [d, s] of Object.entries(dev.days || {})) days[d] = (days[d] || 0) + s;
    for (const [k, t] of Object.entries(dev.titles || {})) {
      const cur = titles[k];
      titles[k] = cur ? { ...cur, ...t, secs: cur.secs + t.secs, lastAt: Math.max(cur.lastAt || 0, t.lastAt || 0) } : { ...t };
    }
  }
  return { days, titles };
}

/** re-render when ratings / lists / stats change */
export function useLibraryExtras(keys = [K_RATINGS, K_LISTS]) {
  const [n, setN] = useState(0);
  const sig = keys.join(",");
  useEffect(() => {
    const h = (e) => {
      if (e.type === EVT && !sig.split(",").includes(e.detail)) return;
      setN((x) => x + 1);
    };
    window.addEventListener(EVT, h);
    window.addEventListener("streambert:sync-applied", h);
    return () => {
      window.removeEventListener(EVT, h);
      window.removeEventListener("streambert:sync-applied", h);
    };
  }, [sig]);
  return { ratings: getRatings(), lists: getLists(), version: n };
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushStats);
  document.addEventListener("visibilitychange", () => document.hidden && flushStats());
}

/** list of days ("YYYY-MM-DD") with watch time, for streaks */
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
