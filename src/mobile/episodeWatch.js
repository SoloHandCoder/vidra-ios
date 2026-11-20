// Keeps the native daily new-episode checker (EpisodeCheckWorker) in sync with
// the app: TMDB token, saved TV shows, the notification setting, and the
// "last episode seen" cache shared with the in-app startup check.
import { native } from "./native.js";

const P = native.plugin;
const LS = (k) => {
  try {
    const r = localStorage.getItem("streambert_" + k);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
};

let lastSig = "";

async function sync() {
  try {
    const token = localStorage.getItem("__secure_apikey") || "";
    const saved = LS("saved") || {};
    const shows = Object.values(saved)
      .filter((s) => s && s.media_type === "tv" && s.id)
      .map((s) => ({ id: s.id, title: s.name || s.title || "" }));
    const pref = LS("notifyNewEpisode");
    const enabled = !(pref === false || pref === 0);
    const cache = LS("episodeReleaseCache") || {};
    const sig = JSON.stringify([token.length, shows.map((s) => s.id), enabled, Object.keys(cache).length]);
    if (sig === lastSig) return;
    lastSig = sig;
    await P.syncEpisodeWatch({ token, shows, enabled, state: cache });
  } catch {}
}

/** Pull what the background check already found into the app's cache, so the
 *  startup banner doesn't repeat episodes that were already notified. */
async function pullState() {
  try {
    const { state } = await P.getEpisodeState();
    if (!state || !Object.keys(state).length) return;
    const cache = LS("episodeReleaseCache") || {};
    let changed = false;
    for (const [id, st] of Object.entries(state)) {
      const cur = cache[id];
      if (!cur || (st.lastEpDate && (!cur.lastEpDate || st.lastEpDate > cur.lastEpDate))) {
        cache[id] = st;
        changed = true;
      }
    }
    if (changed) localStorage.setItem("streambert_episodeReleaseCache", JSON.stringify(cache));
  } catch {}
}

export function initEpisodeWatch() {
  pullState();
  setTimeout(sync, 4000);
  setInterval(sync, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sync();
  });
}
