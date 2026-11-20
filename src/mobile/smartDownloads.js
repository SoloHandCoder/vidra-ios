// Smart downloads: when you finish an episode, the next 1–3 episodes of that
// show are downloaded automatically (only on Wi-Fi, only while there's room
// under the storage limit). Also: the download storage limit itself.
import { tmdbFetch, getSourceUrl, PLAYER_SOURCES, sourceIdType, sourceIsAsync, sourceIsMovieOnly, fetchImdbId } from "../utils/api";
import { downloadSeason } from "./seasonDownload.js";

const K_NEXT = "streambert_autoDownloadNext"; // 0 | 1 | 2 | 3
const K_LIMIT = "streambert_storageLimitGB"; // 0 = no limit
const read = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? d;
  } catch {
    return d;
  }
};
export const getAutoNext = () => Number(read(K_NEXT, 0)) || 0;
export const setAutoNext = (n) => localStorage.setItem(K_NEXT, JSON.stringify(Number(n) || 0));
export const getStorageLimitGB = () => Number(read(K_LIMIT, 0)) || 0;
export const setStorageLimitGB = (n) => localStorage.setItem(K_LIMIT, JSON.stringify(Number(n) || 0));

/** null when there's room, otherwise a message for the user */
export async function storageLimitReached() {
  const gb = getStorageLimitGB();
  if (!gb) return null;
  try {
    const { bytes } = (await window.electron.getDownloadsSize()) || {};
    if ((bytes || 0) >= gb * 1e9) {
      return `Storage limit reached (${gb} GB). Delete some downloads or raise the limit in Settings → Downloads.`;
    }
  } catch {}
  return null;
}

const queue = [];
let busy = false;

/** call when an episode was marked watched: key "tv_<id>_s<season>e<episode>" */
export function onEpisodeWatched(key) {
  const apiKey = localStorage.getItem("__secure_apikey") || "";
  const n = getAutoNext();
  const m = /^tv_(\d+)_s(\d+)e(\d+)$/.exec(String(key || ""));
  if (!n || !m || !apiKey) return;
  queue.push({ id: Number(m[1]), season: Number(m[2]), episode: Number(m[3]), n, apiKey });
  if (!busy) drain();
}

async function drain() {
  busy = true;
  try {
    while (queue.length) await runOne(queue.shift());
  } finally {
    busy = false;
  }
}

async function onWifi() {
  try {
    const r = await window.electron?.networkInfo?.();
    return !!r?.unmetered;
  } catch {
    return false;
  }
}

async function runOne({ id, season, episode, n, apiKey }) {
  if (!(await onWifi())) return; // only on Wi-Fi
  if (await storageLimitReached()) return;
  let show;
  try {
    show = await tmdbFetch(`/tv/${id}`, apiKey);
  } catch {
    return;
  }
  // next n aired episodes, possibly running into the next season
  const today = new Date().toISOString().slice(0, 10);
  const next = [];
  let s = season, after = episode;
  for (let guard = 0; next.length < n && guard < 3; guard++) {
    let data;
    try {
      data = await tmdbFetch(`/tv/${id}/season/${s}`, apiKey);
    } catch {
      break;
    }
    const eps = (data?.episodes || []).filter((e) => e.episode_number > after && (!e.air_date || e.air_date <= today));
    for (const e of eps) {
      if (next.length >= n) break;
      next.push({ season: s, episode_number: e.episode_number });
    }
    if (next.length >= n) break;
    const last = (show.seasons || []).reduce((mx, x) => Math.max(mx, x.season_number || 0), 0);
    if (s >= last) break;
    s += 1;
    after = 0;
  }
  if (!next.length) return;

  // skip what's already downloaded / downloading
  let have = new Set();
  try {
    have = new Set(
      (await window.electron.getDownloads())
        .filter((d) => d.mediaType === "tv" && (d.tmdbId === id || d.mediaId === id) && d.status !== "error")
        .map((d) => `${d.season}_${d.episode}`),
    );
  } catch {}
  const todo = next.filter((e) => !have.has(`${e.season}_${e.episode_number}`));
  if (!todo.length) return;

  // the source you use, if it can be downloaded from without a player on screen
  let src = read("streambert_playerSource", PLAYER_SOURCES[0].id);
  const usable = (x) => x && !sourceIsMovieOnly(x) && sourceIdType(x) !== "kinopoisk";
  if (!usable(src)) src = PLAYER_SOURCES.find((p) => p.tvUrl && !p.movieOnly && (p.idType ?? "tmdb") === "tmdb" && !sourceIsAsync(p.id))?.id;
  if (!src) return;
  let srcId = id;
  if (sourceIdType(src) === "imdb") {
    try {
      srcId = await fetchImdbId("tv", id, apiKey);
    } catch {
      srcId = null;
    }
    if (!srcId) return;
  }
  const year = (show.first_air_date || "").slice(0, 4);
  const bySeason = new Map();
  for (const e of todo) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season).push({ episode_number: e.episode_number });
  }
  for (const [sn, eps] of bySeason) {
    await downloadSeason({
      label: "Auto-download",
      baseName: `${show.name}${year ? ` (${year})` : ""}`,
      tmdbId: id,
      season: sn,
      posterPath: show.poster_path || null,
      episodes: eps,
      skip: new Set(),
      async: sourceIsAsync(src),
      animeTitle: show.name,
      dubMode: read("streambert_hianimeDubMode", "sub"),
      embedUrl: (ep) => getSourceUrl(src, "tv", srcId, sn, ep.episode_number, {}),
    });
  }
}
