// Discovery: upcoming episodes / releases of your shows and watchlist, and
// "Because you watched …" recommendation rows.
import { tmdbFetch } from "../utils/api";
import { getRatings } from "./libraryExtras.js";

const UP_CACHE = "streambert_upcomingCache"; // { at, key, items }
const UP_TTL = 6 * 3600 * 1000;
const MAX_SHOWS = 40;
const DAYS_AHEAD = 120;

const today0 = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const parseDay = (s) => (s ? new Date(s + "T12:00:00") : null);

/** TV shows to follow: saved shows first, then shows from the watch history. */
function followedShows(saved, history) {
  const out = new Map();
  for (const s of Object.values(saved || {})) if (s?.media_type === "tv" && s.id) out.set(s.id, s);
  for (const h of history || []) if (h?.media_type === "tv" && h.id && !out.has(h.id)) out.set(h.id, h);
  return [...out.values()].slice(0, MAX_SHOWS);
}

/**
 * Upcoming items, soonest first:
 *  { kind: "episode"|"movie", date: "YYYY-MM-DD", id, media_type, title, poster_path,
 *    season, episode, episodeName, fromWatchlist }
 */
export async function loadUpcoming(apiKey, saved, history, { force = false } = {}) {
  if (!apiKey) return [];
  const shows = followedShows(saved, history);
  const movies = Object.values(saved || {}).filter((s) => s?.media_type === "movie" && s.id);
  const key = [...shows.map((s) => "t" + s.id), ...movies.map((m) => "m" + m.id)].sort().join(",");
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(UP_CACHE) || "null");
      if (c && c.key === key && Date.now() - c.at < UP_TTL) return c.items;
    } catch {}
  }
  const start = today0();
  const end = new Date(start.getTime() + DAYS_AHEAD * 86400000);
  const inRange = (d) => d && d >= start && d <= end;
  const savedIds = new Set(Object.values(saved || {}).map((x) => `${x?.media_type}_${x?.id}`));
  const items = [];

  await Promise.all([
    ...shows.map((s) =>
      tmdbFetch(`/tv/${s.id}`, apiKey)
        .then((d) => {
          const ep = d?.next_episode_to_air;
          if (!ep || !inRange(parseDay(ep.air_date))) return;
          items.push({
            kind: "episode",
            date: ep.air_date,
            id: s.id,
            media_type: "tv",
            title: d.name || s.name || s.title || "",
            poster_path: d.poster_path || s.poster_path || null,
            season: ep.season_number,
            episode: ep.episode_number,
            episodeName: ep.name || "",
            fromWatchlist: savedIds.has(`tv_${s.id}`),
          });
        })
        .catch(() => {}),
    ),
    ...movies
      .filter((m) => !m.release_date || parseDay(m.release_date) >= start || Number(m.year) >= start.getFullYear())
      .map((m) =>
        tmdbFetch(`/movie/${m.id}`, apiKey)
          .then((d) => {
            if (!d?.release_date || !inRange(parseDay(d.release_date))) return;
            items.push({
              kind: "movie",
              date: d.release_date,
              id: m.id,
              media_type: "movie",
              title: d.title || m.title || "",
              poster_path: d.poster_path || m.poster_path || null,
              fromWatchlist: true,
            });
          })
          .catch(() => {}),
      ),
  ]);
  items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  try {
    localStorage.setItem(UP_CACHE, JSON.stringify({ at: Date.now(), key, items }));
  } catch {}
  return items;
}

/** "Today", "Tomorrow", "Friday", "Sat, 29 Nov" … */
export function dayLabel(dateStr) {
  const d = parseDay(dateStr);
  const diff = Math.round((d - today0()) / 86400000 - 0.5);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return d.toLocaleDateString(document.documentElement.lang || undefined, { weekday: "long" });
  return d.toLocaleDateString(document.documentElement.lang || undefined, { weekday: "short", day: "numeric", month: "short" });
}
export function daysUntil(dateStr) {
  return Math.max(0, Math.round((parseDay(dateStr) - today0()) / 86400000 - 0.5));
}

// ── "Because you watched …" ──────────────────────────────────────────────────

/** Up to `count` seeds: titles you rated 4–5 stars recently, then recent history. */
function seeds(history, count) {
  const out = [];
  const seen = new Set();
  const add = (it) => {
    const type = it?.media_type === "tv" ? "tv" : "movie";
    const k = `${type}_${it?.id}`;
    if (!it?.id || seen.has(k)) return;
    seen.add(k);
    out.push({ id: it.id, media_type: type, title: it.title || it.name || "" });
  };
  const loved = Object.values(getRatings())
    .filter((r) => r.stars >= 4 && r.item && Date.now() - (r.at || 0) < 60 * 86400000)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  if (loved[0]) add(loved[0].item);
  const recent = [...(history || [])].filter((h) => h.watchedAt).sort((a, b) => b.watchedAt - a.watchedAt);
  for (const h of recent) {
    if (out.length >= count) break;
    add(h);
  }
  for (const r of loved.slice(1)) {
    if (out.length >= count) break;
    add(r.item);
  }
  return out.slice(0, count);
}

/** [{ source: {id, media_type, title}, items: [...] }] — one row per seed */
export async function loadBecauseRows(apiKey, history, { count = 3, exclude = new Set() } = {}) {
  if (!apiKey) return [];
  const watched = new Set((history || []).map((h) => `${h.media_type === "tv" ? "tv" : "movie"}_${h.id}`));
  const used = new Set();
  const rows = await Promise.all(
    seeds(history, count).map(async (src) => {
      const type = src.media_type;
      let res = [];
      try {
        res = (await tmdbFetch(`/${type}/${src.id}/recommendations`, apiKey))?.results || [];
        if (!res.length) res = (await tmdbFetch(`/${type}/${src.id}/similar`, apiKey))?.results || [];
      } catch {}
      return { source: src, raw: res.map((i) => ({ ...i, media_type: i.media_type || type })) };
    }),
  );
  // keep rows distinct: an item shows in the first row that has it
  return rows
    .map(({ source, raw }) => {
      const items = raw
        .filter((i) => {
          const k = `${i.media_type}_${i.id}`;
          if (watched.has(k) || exclude.has(k) || used.has(k) || !i.poster_path) return false;
          used.add(k);
          return true;
        })
        .slice(0, 15);
      return { source, items };
    })
    .filter((r) => r.items.length >= 4);
}
