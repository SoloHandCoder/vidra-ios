// Trakt (trakt.tv): link an account, import history / ratings / watchlist, add
// what you finish to your Trakt history, send your ratings, and show what
// you're watching right now ("scrobbling").
//
// You create a free API app on trakt.tv once and paste its Client ID and
// Secret. The app (Client ID/Secret) is kept per device; the Trakt login is
// kept per profile on this device and never synced to the cloud.
import { tmdbFetch } from "../utils/api";

const API = () => localStorage.getItem("__sb_trakt_api") || "https://api.trakt.tv";
const K_APP = "__sb_trakt_app"; // { clientId, clientSecret }
const K_OPTS = "__sb_trakt_opts"; // { scrobble, history, ratings }
const authKey = () => {
  try {
    const m = JSON.parse(localStorage.getItem("__sb_profiles") || "null");
    return `__sb_trakt_auth_${m?.current || "default"}`;
  } catch {
    return "__sb_trakt_auth_default";
  }
};
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  if (v == null) localStorage.removeItem(k);
  else localStorage.setItem(k, JSON.stringify(v));
  window.dispatchEvent(new Event("streambert:trakt-changed"));
};

export const getTraktApp = () => read(K_APP, null);
export const setTraktApp = (clientId, clientSecret) => write(K_APP, { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() });
export const getTraktAuth = () => read(authKey(), null); // { access_token, refresh_token, created_at, expires_in, user }
export const traktConnected = () => !!getTraktApp()?.clientId && !!getTraktAuth()?.access_token;
export const getTraktOpts = () => ({ scrobble: true, history: true, ratings: true, ...read(K_OPTS, {}) });
export const setTraktOpts = (o) => write(K_OPTS, { ...getTraktOpts(), ...o });
export const disconnectTrakt = () => write(authKey(), null);

/** one HTTP request through the app's native / main-process side (no CORS) */
async function http(method, path, body, { auth = true } = {}) {
  const app = getTraktApp();
  if (!app?.clientId) throw new Error("Add your Trakt Client ID first.");
  const headers = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": app.clientId };
  if (auth) {
    await refreshIfNeeded();
    const a = getTraktAuth();
    if (!a?.access_token) throw new Error("Not connected to Trakt.");
    headers.Authorization = `Bearer ${a.access_token}`;
  }
  const r = await window.electron.traktFetch({ method, url: API() + path, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = r.data ? JSON.parse(r.data) : null;
  } catch {}
  if (r.status === 401 && auth) {
    disconnectTrakt();
    throw new Error("Trakt signed you out. Connect again.");
  }
  if (r.status === 429) throw new Error("Trakt says: too many requests. Try again in a minute.");
  return { status: r.status, data };
}

async function refreshIfNeeded() {
  const a = getTraktAuth();
  const app = getTraktApp();
  if (!a?.refresh_token || !app) return;
  const exp = (a.created_at || 0) * 1000 + (a.expires_in || 0) * 1000;
  if (exp && Date.now() < exp - 3600 * 1000) return;
  const r = await window.electron.traktFetch({
    method: "POST",
    url: API() + "/oauth/token",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: a.refresh_token, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: "urn:ietf:wg:oauth:2.0:oob", grant_type: "refresh_token" }),
  });
  if (r.status === 200) {
    const t = JSON.parse(r.data);
    write(authKey(), { ...a, ...t });
  }
}

// ── connect (device code: enter a short code on trakt.tv/activate) ──────────
/** starts linking; calls onCode({ user_code, verification_url }) and resolves when done */
export async function connectTrakt(onCode, isCancelled = () => false) {
  const app = getTraktApp();
  if (!app?.clientId || !app?.clientSecret) throw new Error("Add your Trakt Client ID and Client Secret first.");
  const { status, data } = await http("POST", "/oauth/device/code", { client_id: app.clientId }, { auth: false });
  if (status !== 200 || !data?.device_code) throw new Error("Trakt didn't accept the Client ID. Check it and try again.");
  onCode?.(data);
  const until = Date.now() + (data.expires_in || 600) * 1000;
  let wait = Math.max(5, data.interval || 5) * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, wait));
    if (isCancelled()) throw new Error("cancelled");
    const r = await http("POST", "/oauth/device/token", { code: data.device_code, client_id: app.clientId, client_secret: app.clientSecret }, { auth: false });
    if (r.status === 200 && r.data?.access_token) {
      write(authKey(), { ...r.data });
      const me = await http("GET", "/users/settings").catch(() => null);
      write(authKey(), { ...r.data, user: me?.data?.user?.username || me?.data?.user?.name || "Trakt" });
      return getTraktAuth();
    }
    if (r.status === 429) wait += 1000; // slow down
    else if (r.status === 404 || r.status === 410) throw new Error("The code expired. Try again.");
    else if (r.status === 418) throw new Error("You declined on Trakt.");
    else if (r.status === 409) throw new Error("This code was already used.");
    // 400 = still waiting for you to enter the code
  }
  throw new Error("The code expired. Try again.");
}

// ── import ───────────────────────────────────────────────────────────────────
const LS = (k, d) => read("streambert_" + k, d);
const setLS = (k, v) => localStorage.setItem("streambert_" + k, JSON.stringify(v));

/** imports into the current profile; onStep(text) reports progress. Returns counts. */
export async function importFromTrakt(apiKey, onStep = () => {}) {
  const counts = { watched: 0, ratings: 0, watchlist: 0 };
  // watched movies / episodes
  onStep("Getting your watched movies…");
  const watched = LS("watched", {});
  const wm = (await http("GET", "/sync/watched/movies")).data || [];
  for (const w of wm) {
    const id = w.movie?.ids?.tmdb;
    if (id && !watched[`movie_${id}`]) {
      watched[`movie_${id}`] = true;
      counts.watched++;
    }
  }
  onStep("Getting your watched episodes…");
  const ws = (await http("GET", "/sync/watched/shows")).data || [];
  for (const s of ws) {
    const id = s.show?.ids?.tmdb;
    if (!id) continue;
    for (const se of s.seasons || [])
      for (const ep of se.episodes || []) {
        const k = `tv_${id}_s${se.number}e${ep.number}`;
        if (!watched[k]) {
          watched[k] = true;
          counts.watched++;
        }
      }
  }
  setLS("watched", watched);

  // history (newest 100, for Continue Watching / Library)
  onStep("Getting your history…");
  const hist = LS("history", []);
  const seen = new Set(hist.map((h) => `${h.media_type}|${h.id}|${h.season ?? ""}|${h.episode ?? ""}`));
  const hh = (await http("GET", "/sync/history?limit=100&extended=full")).data || [];
  for (const h of hh) {
    const isMovie = h.type === "movie";
    const id = isMovie ? h.movie?.ids?.tmdb : h.show?.ids?.tmdb;
    if (!id) continue;
    const e = {
      id,
      media_type: isMovie ? "movie" : "tv",
      title: isMovie ? h.movie.title : h.show.title,
      poster_path: null,
      watchedAt: new Date(h.watched_at).getTime() || Date.now(),
      ...(isMovie ? {} : { season: h.episode?.season, episode: h.episode?.number, episodeName: h.episode?.title || null }),
    };
    const k = `${e.media_type}|${e.id}|${e.season ?? ""}|${e.episode ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    hist.push(e);
  }
  hist.sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
  const top = hist.slice(0, 100);
  // posters for imported entries
  await Promise.all(
    top.filter((h) => !h.poster_path).slice(0, 40).map((h) =>
      tmdbFetch(`/${h.media_type}/${h.id}`, apiKey)
        .then((d) => (h.poster_path = d?.poster_path || null))
        .catch(() => {}),
    ),
  );
  setLS("history", top);

  // ratings (Trakt 1–10 → 1–5 stars)
  onStep("Getting your ratings…");
  const ratings = LS("myRatings", {});
  for (const type of ["movies", "shows"]) {
    const rs = (await http("GET", `/sync/ratings/${type}`)).data || [];
    for (const r of rs) {
      const it = type === "movies" ? r.movie : r.show;
      const id = it?.ids?.tmdb;
      if (!id) continue;
      const mt = type === "movies" ? "movie" : "tv";
      const k = `${mt}_${id}`;
      if (ratings[k]) continue;
      ratings[k] = { stars: Math.max(1, Math.min(5, Math.round(r.rating / 2))), at: new Date(r.rated_at).getTime() || Date.now(), item: { id, media_type: mt, title: it.title, poster_path: null } };
      counts.ratings++;
    }
  }
  setLS("myRatings", ratings);

  // watchlist → saved
  onStep("Getting your watchlist…");
  const saved = LS("saved", {});
  const wl = (await http("GET", "/sync/watchlist?extended=full")).data || [];
  const add = [];
  for (const w of wl) {
    const isMovie = w.type === "movie";
    const it = isMovie ? w.movie : w.show;
    const id = it?.ids?.tmdb;
    if (!id || (w.type !== "movie" && w.type !== "show")) continue;
    const k = `${isMovie ? "movie" : "tv"}_${id}`;
    if (saved[k]) continue;
    add.push({ k, id, media_type: isMovie ? "movie" : "tv", title: it.title, year: it.year ? String(it.year) : "" });
  }
  await Promise.all(
    add.slice(0, 80).map((a) =>
      tmdbFetch(`/${a.media_type}/${a.id}`, apiKey)
        .then((d) => {
          saved[a.k] = { id: a.id, media_type: a.media_type, title: d?.title || d?.name || a.title, name: d?.name, poster_path: d?.poster_path || null, backdrop_path: d?.backdrop_path || null, vote_average: d?.vote_average, year: a.year };
          counts.watchlist++;
        })
        .catch(() => {
          // no TMDB details right now: keep Trakt's title, the poster comes later
          saved[a.k] = { id: a.id, media_type: a.media_type, title: a.title, name: a.title, poster_path: null, year: a.year };
          counts.watchlist++;
        }),
    ),
  );
  setLS("saved", saved);
  window.dispatchEvent(new Event("streambert:sync-applied")); // the app reloads its lists
  return counts;
}

// ── while watching ───────────────────────────────────────────────────────────
const target = ({ media_type, id, season, episode }) =>
  media_type === "movie" ? { movie: { ids: { tmdb: Number(id) } } } : { show: { ids: { tmdb: Number(id) } }, episode: { season: Number(season), number: Number(episode) } };

/** called when an episode / movie is marked watched in the app: "tv_<id>_s1e2" | "movie_<id>" */
export function traktMarkWatched(key) {
  if (!traktConnected() || !getTraktOpts().history) return;
  let m = /^movie_(\d+)$/.exec(key);
  let body = null;
  if (m) body = { movies: [{ ids: { tmdb: Number(m[1]) }, watched_at: new Date().toISOString() }] };
  m = /^tv_(\d+)_s(\d+)e(\d+)$/.exec(key);
  if (m) body = { shows: [{ ids: { tmdb: Number(m[1]) }, seasons: [{ number: Number(m[2]), episodes: [{ number: Number(m[3]), watched_at: new Date().toISOString() }] }] }] };
  if (body) http("POST", "/sync/history", body).catch(() => {});
}

/** your rating changed (0 = removed) */
export function traktRate(item, stars) {
  if (!traktConnected() || !getTraktOpts().ratings || !item?.id) return;
  const type = item.media_type === "tv" ? "shows" : "movies";
  const entry = { ids: { tmdb: Number(item.id) } };
  if (stars) http("POST", "/sync/ratings", { [type]: [{ ...entry, rating: stars * 2 }] }).catch(() => {});
  else http("POST", "/sync/ratings/remove", { [type]: [entry] }).catch(() => {});
}

// "watching now": start / pause, throttled
let sc = { key: "", state: "", at: 0 };
/** info: { id, media_type, season?, episode? }, progress 0-100, playing */
export function traktScrobble(info, progress, playing) {
  if (!traktConnected() || !getTraktOpts().scrobble || !info?.id) return;
  if (info.media_type === "tv" && (info.season == null || info.episode == null)) return;
  const key = `${info.media_type}_${info.id}_${info.season ?? ""}_${info.episode ?? ""}`;
  const state = playing ? "start" : "pause";
  const now = Date.now();
  // tell Trakt when it starts / pauses, and refresh every 10 min while playing
  if (key === sc.key && state === sc.state && now - sc.at < 10 * 60 * 1000) return;
  sc = { key, state, at: now };
  http("POST", `/scrobble/${state}`, { ...target(info), progress: Math.max(0, Math.min(100, Number(progress) || 0)) }).catch(() => {});
}
