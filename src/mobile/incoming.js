// App shortcuts (long-press the icon) and links shared / opened with Streambert.
//   streambert://open/search | downloads | continue | library | settings
//   https://www.themoviedb.org/movie/550-fight-club, .../tv/1399
//   https://www.imdb.com/title/tt0137523/   (resolved through TMDB /find)
import { native } from "./native.js";
import { tmdbFetch } from "../utils/api";
import { secureStorage } from "../utils/storage";

function waitForApp(timeout = 15000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (window.__sbNav?.open) return resolve(true);
      if (Date.now() - t0 > timeout) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function toast(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom));transform:translateX(-50%);" +
    "background:#222;color:#f0f0f0;border:1px solid #2a2a2a;padding:10px 16px;border-radius:20px;" +
    "font:500 13px 'DM Sans',sans-serif;z-index:2147483647;pointer-events:none;max-width:86vw;text-align:center";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/** Extracts { type, id } (TMDB) or { imdb } from any text containing a link. */
export function parseLink(text) {
  const s = String(text || "");
  let m = s.match(/themoviedb\.org\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(movie|tv)\/(\d+)/i);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]) };
  m = s.match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d{5,10})/i);
  if (m) return { imdb: m[1] };
  m = s.match(/\b(tt\d{7,10})\b/);
  if (m) return { imdb: m[1] };
  return null;
}

async function openTitle(link) {
  const apiKey = await secureStorage.get("apikey");
  if (!apiKey) {
    toast("Add your TMDB token in Streambert first, then try again");
    return;
  }
  let type = link.type, id = link.id;
  if (link.imdb) {
    const r = await tmdbFetch(`/find/${link.imdb}?external_source=imdb_id`, apiKey);
    const hit = r?.movie_results?.[0] ? ["movie", r.movie_results[0]] : r?.tv_results?.[0] ? ["tv", r.tv_results[0]] : null;
    if (!hit) {
      toast("Couldn't find that title on TMDB");
      return;
    }
    [type, { id }] = hit;
  }
  let item;
  try {
    item = await tmdbFetch(`/${type}/${id}`, apiKey);
  } catch {
    item = null;
  }
  if (!item?.id) {
    toast("Couldn't load that title");
    return;
  }
  window.__sbNav.open({ ...item, media_type: type });
}

async function handle(text) {
  if (!text) return;
  if (!(await waitForApp())) return;
  const nav = window.__sbNav;
  const title = String(text).match(/^streambert:\/\/(?:open\/)?(movie|tv)\/(\d+)(?:\?(.*))?/i);
  if (title) {
    const type = title[1].toLowerCase();
    const id = Number(title[2]);
    const q = new URLSearchParams(title[3] || "");
    // widget / continue watching: reopen straight from history (works offline)
    try {
      const hist = JSON.parse(localStorage.getItem("streambert_history") || "[]");
      const s = q.get("s"), e = q.get("e");
      const hit =
        hist.find((h) => h.id === id && h.media_type === type && (s == null || (String(h.season) === s && String(h.episode) === e))) ||
        hist.find((h) => h.id === id && h.media_type === type);
      if (hit) {
        nav.open(hit);
        return;
      }
    } catch {}
    try {
      await openTitle({ type: title[1].toLowerCase(), id: Number(title[2]) });
    } catch {
      toast("Couldn't open that title");
    }
    return;
  }
  if (/^streambert:\/\/party\//i.test(String(text))) {
    window.dispatchEvent(new CustomEvent("streambert:party-join", { detail: { link: String(text) } }));
    return;
  }
  const sc = String(text).match(/^streambert:\/\/(?:open\/)?([a-z-]+)/i);
  if (sc) {
    const what = sc[1].toLowerCase();
    if (what === "search") nav.openSearch();
    else if (what === "downloads") nav.go("downloads");
    else if (what === "library" || what === "history") nav.go("history");
    else if (what === "settings") nav.go("settings");
    else if (what === "continue") {
      if (!nav.continueWatching()) {
        nav.go("history");
        toast("Nothing to continue yet");
      }
    }
    return;
  }
  const link = parseLink(text);
  if (link) {
    try {
      await openTitle(link);
    } catch {
      toast("Couldn't open that link");
    }
    return;
  }
  // plain text shared → search for it
  nav.openSearch();
  toast("Only TMDB and IMDb links can be opened directly");
}

export function initIncoming() {
  native.on("incoming", (d) => handle(d?.text));
  native.plugin
    .takeIncoming()
    .then((r) => r?.text && handle(r.text))
    .catch(() => {});
}
