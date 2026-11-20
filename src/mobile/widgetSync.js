// Pushes the latest 3 titles of the current profile's history to the
// "Continue watching" home-screen widget.
import { native } from "./native.js";

const LS = (k) => {
  try {
    const r = localStorage.getItem("streambert_" + k);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
};

let lastSig = "";

export function syncWidget() {
  try {
    const history = LS("history") || [];
    const progress = LS("progress") || {};
    const seen = new Set();
    const items = [];
    for (const h of history) {
      if (!h?.id || !h.media_type) continue;
      const key = `${h.media_type}_${h.id}`;
      if (seen.has(key)) continue; // one card per show
      seen.add(key);
      const isTv = h.media_type === "tv";
      const pk = isTv ? `tv_${h.id}_s${h.season}e${h.episode}` : `movie_${h.id}`;
      const it = {
        id: h.id,
        type: isTv ? "tv" : "movie",
        title: h.title || h.name || "",
        subtitle: isTv && h.season != null ? `S${h.season} · E${h.episode}` : "Movie",
        poster: h.poster_path || "",
        progress: Math.max(0, Math.min(100, Math.round(progress[pk] || 0))),
      };
      if (isTv && h.season != null) {
        it.season = Number(h.season);
        it.episode = Number(h.episode || 1);
      }
      items.push(it);
      if (items.length === 3) break;
    }
    const sig = JSON.stringify(items);
    if (sig === lastSig) return;
    lastSig = sig;
    native.plugin.updateWidget({ items }).catch(() => {});
  } catch {}
}

export function initWidgetSync() {
  setTimeout(syncWidget, 3000);
  setInterval(syncWidget, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) syncWidget();
  });
}
