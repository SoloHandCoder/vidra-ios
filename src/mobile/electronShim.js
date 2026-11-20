// window.electron implementation for iOS (shared with the Android port).
// The desktop UI talks to Electron's main process through `window.electron`
// (preload.js). This module provides the same API on top of the native
// Capacitor plugin (android/app/src/main/java/com/streambert/android/*), so the
// React code stays (almost) identical to the desktop app.
import { App as CapApp } from "@capacitor/app";
import { native, isNative, fileSrc } from "./native.js";
import * as hianime from "./hianime.js";
import * as subs from "./subtitles.js";
import { frameById, execInFrame } from "./MobileWebView.jsx";
import { openLocalPlayer } from "./localPlayer.js";
import { enterPip, setCastHandler, getPlaybackState } from "./playback.js";
import { castAvailable, castMedia, stopCast, onCastState } from "./cast.js";

const P = native.plugin;
const PREFIX = "streambert_";

// ── tiny event hub (ipcRenderer.on equivalent) ───────────────────────────────
const hub = new Map();
const on = (ev, cb) => {
  if (!hub.has(ev)) hub.set(ev, new Set());
  hub.get(ev).add(cb);
  return cb;
};
const off = (ev, cb) => hub.get(ev)?.delete(cb);
const fire = (ev, data) => hub.get(ev)?.forEach((cb) => {
  try { cb(data); } catch (e) { console.error(e); }
});

let paths = { downloads: "", files: "", cache: "", version: "2.7.0" };
const pathsReady = isNative
  ? P.getPaths().then((p) => { paths = { ...paths, ...p }; return paths; }).catch(() => paths)
  : Promise.resolve(paths);

const setLS = (k, v) => {
  try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch {}
};
const getLS = (k) => {
  try { const r = localStorage.getItem(PREFIX + k); return r ? JSON.parse(r) : null; } catch { return null; }
};

// Download / downloader folder are fixed on Android (app storage, native downloader)
pathsReady.then((p) => {
  if (!p.downloads) return;
  setLS("downloaderFolder", "android-native");
  setLS("downloadPath", p.downloads);
});

// ── native events → app events ───────────────────────────────────────────────
if (isNative) {
  native.on("m3u8Found", (d) => streamFound(d.url));
  native.on("subtitleFound", (d) => {
    fire("subtitle-found", { url: d.url, lang: subs.extractSubtitleLang(d.url) });
  });
  native.on("blocked", (d) => fire("blocked-stats-update", d));
  native.on("updateProgress", (d) => fire("update-progress", d));
  native.on("downloadProgress", (d) => {
    const clean = { ...d };
    delete clean._dir;
    fire("download-progress", clean);
  });
  // embedded player asked for fullscreen while intercepting → in-app fullscreen (toggle)
  native.on("webviewFullscreenRequest", () => {
    if (document.documentElement.hasAttribute("data-player-fullscreen")) exitPlayerFullscreen();
    else {
      fire("webview-enter-fullscreen");
      P.setFullscreen({ on: true }).catch(() => {});
    }
  });
  native.on("fullscreen", (d) => {
    if (!d.value) lastFsExit = Date.now();
    if (d.value) document.documentElement.setAttribute("data-native-fullscreen", "1");
    else document.documentElement.removeAttribute("data-native-fullscreen");
    fire(d.value ? "webview-enter-fullscreen" : "webview-leave-fullscreen");
  });
}

const postProcessed = new Set();
function exitPlayerFullscreen() {
  fire("webview-leave-fullscreen");
  P.setFullscreen({ on: false }).catch(() => {});
}
async function downloadFor(filePath) {
  try {
    return (await native.getDownloads()).find((d) => d.filePath === filePath) || null;
  } catch {
    return null;
  }
}
// what a download is (for watch statistics)
function mediaOf(d) {
  const id = d?.tmdbId || d?.mediaId;
  if (!id || !d.mediaType) return null;
  return { id, media_type: d.mediaType, title: d.showName || d.title || d.name || "", poster_path: d.posterPath || d.poster_path || null };
}
let lastStreamUrl = null;
let captureSink = null; // set while a hidden player is resolving a stream (season download)
function streamFound(url) {
  if (captureSink) {
    captureSink(url);
    return;
  }
  lastStreamUrl = url;
  fire("m3u8-found", url);
}

/**
 * Loads an embed player URL in a hidden frame, starts playback and returns the
 * HLS stream it requests ({ url } or null after the timeout). Used to download
 * whole seasons without playing every episode by hand.
 */
async function captureStream(embedUrl, timeoutMs = 45000) {
  while (captureSink) await new Promise((r) => setTimeout(r, 300));
  const found = [];
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  captureSink = (url) => {
    found.push(url);
    resolveFirst();
  };
  const f = document.createElement("iframe");
  f.setAttribute("data-sb-capture", "1");
  f.allow = "autoplay; fullscreen";
  f.style.cssText =
    "position:fixed;right:0;bottom:0;width:480px;height:270px;opacity:0.01;pointer-events:none;z-index:-1;border:0";
  f.src = embedUrl;
  document.body.appendChild(f);
  const kick = setInterval(() => {
    execInFrame(
      f,
      `(() => { const v = document.querySelector('video');
         if (v) { v.muted = true; v.play().catch(() => {}); return true; }
         const b = document.querySelector('.play-button, .vjs-big-play-button, .jw-display-icon-container, [class*="play" i] button, button[aria-label*="play" i], #play, .plyr__control--overlaid');
         if (b) { b.click(); return true; }
         return null; })()`,
      { deep: true, timeout: 1500 },
    ).catch(() => {});
  }, 2500);
  try {
    const timer = new Promise((r) => setTimeout(r, timeoutMs));
    await Promise.race([first, timer]);
    if (found.length) await new Promise((r) => setTimeout(r, 2500)); // let the master/media playlists settle
  } finally {
    clearInterval(kick);
    captureSink = null;
    f.remove();
  }
  if (!found.length) return null;
  // prefer a master playlist (reported with master flag) → the last reported master
  const masters = found.filter((u) => frameStreamMeta.get(u)?.master);
  return { url: (masters.length ? masters[masters.length - 1] : found[found.length - 1]) };
}

// ── Chromecast ──────────────────────────────────────────────────────────────
function refererFor(url) {
  return hianime.hianimeReferers.get(url) || frameStreamMeta.get(url)?.referer || null;
}
async function castStream({ url, title, startTime = 0, isLocal = false, subtitleUrl = null } = {}) {
  url = url || lastStreamUrl;
  if (!url) {
    toast("Start playback first, then cast");
    return { ok: false, error: "No stream found yet" };
  }
  let res;
  try {
    res = await castMedia({
      url,
      title: title || document.querySelector(".main .detail-title")?.textContent?.trim() || "Vidra",
      referer: isLocal ? undefined : refererFor(url) || undefined,
      startTime: Math.floor(startTime || getPlaybackState().position || 0),
      subtitleUrl: subtitleUrl || undefined,
      isLocal,
    });
  } catch (e) {
    res = { ok: false, error: String(e?.message || e) };
  }
  if (res?.ok) toast("Casting…");
  else if (res?.error) toast(res.error);
  return res;
}
setCastHandler(({ frame, t }) => {
  if (frame?.hasAttribute("data-sb-local-player")) {
    let key = null, title = null;
    try {
      const q = new URL(frame.src).searchParams;
      key = q.get("key");
      title = q.get("title");
    } catch {}
    if (key) castStream({ url: key, title, startTime: t, isLocal: key.startsWith("/") });
  } else {
    castStream({ startTime: t });
  }
});

// Playlists detected by content inside player frames (see sb-inject.js)
const frameStreamMeta = new Map();
const lastMasterByReferer = new Map();
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.__sb !== "m3u8" || typeof d.url !== "string") return;
  if (!/^https?:\/\//.test(d.url) || frameStreamMeta.has(d.url)) return;
  if (!d.master) {
    // media playlist actually loaded by the player (carries per-playlist tokens)
    const master = lastMasterByReferer.get(d.referer);
    if (master) {
      const m = frameStreamMeta.get(master);
      if (m) m.media = d.url;
      return;
    }
  } else {
    lastMasterByReferer.set(d.referer, d.url);
  }
  frameStreamMeta.set(d.url, { referer: d.referer, origin: d.origin, master: !!d.master });
  streamFound(d.url);
});

/** Subtitles captured/selected before a download started (desktop does this in main). */
async function downloadEntrySubtitles(entry) {
  const list = Array.isArray(entry.subtitles) ? entry.subtitles : [];
  if (!list.length || !entry.filePath) return;
  const dir = entry.filePath.replace(/\/[^/]+$/, "");
  const base = entry.filePath.endsWith("/index.m3u8")
    ? dir.split("/").pop()
    : entry.filePath.split("/").pop().replace(/\.[^.]+$/, "");
  const out = [];
  const used = new Set();
  for (const s of list) {
    try {
      let data, ext = "vtt";
      if (s.url?.startsWith("data:")) {
        const m = s.url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
        data = m[2] ? m[3] : btoa(unescape(encodeURIComponent(decodeURIComponent(m[3]))));
        if (/srt|subrip/i.test(m[1] || "")) ext = "srt";
      } else {
        const ref = hianime.hianimeReferers.get(entry.m3u8Url) || frameStreamMeta.get(entry.m3u8Url)?.referer;
        const headers = ref ? { Referer: ref, Origin: new URL(ref).origin } : {};
        const res = await native.http({ url: s.url, headers, responseType: "base64", timeout: 20000 });
        if (res.status >= 400) continue;
        data = res.data;
        if (/\.srt(\?|$)/i.test(s.url) || /subrip|srt/i.test(res.headers["content-type"] || "")) ext = "srt";
      }
      const lang = String(s.lang || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 12) || "unknown";
      let name = `${base}.${lang}.${ext}`;
      let i = 2;
      while (used.has(name)) name = `${base}.${lang}.${i++}.${ext}`;
      used.add(name);
      const path = `${dir}/${name}`;
      await native.writeFile({ path, data, encoding: "base64" });
      out.push({ lang: s.lang || "unknown", path, name: s.name || name, file_id: s.file_id || null });
    } catch {}
  }
  if (!out.length) return;
  await native.updateDownload({ id: entry.id, patch: { subtitlePaths: out } });
  fire("download-progress", { id: entry.id, subtitlePaths: out });
}

// ── Android back button ──────────────────────────────────────────────────────
const OVERLAY_SELECTORS = [
  ".modal-overlay", ".trailer-overlay", ".search-overlay", "[class*='modal-backdrop']",
  "[class*='-overlay']:not(.player-overlay-group):not(.player-overlay-btn)", "[role='dialog']",
];
function hasOpenOverlay() {
  for (const sel of OVERLAY_SELECTORS) {
    let els;
    try { els = document.querySelectorAll(sel); } catch { continue; }
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && cs.display !== "none" && cs.visibility !== "hidden" && el.offsetWidth > 0) {
        return el;
      }
    }
  }
  return null;
}
function sendEscape() {
  const ev = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", ev));
  window.dispatchEvent(new KeyboardEvent("keydown", ev));
}
let lastBack = 0;
let lastFsExit = 0;
if (isNative) {
  CapApp.addListener("backButton", () => {
    if (Date.now() - lastFsExit < 700) return;
    if (window.__sbLocalPlayerClose?.()) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (document.documentElement.hasAttribute("data-player-fullscreen")) {
      exitPlayerFullscreen();
      return;
    }
    if (window.__sbSheetBack?.()) return;
    const overlay = hasOpenOverlay();
    if (overlay) {
      sendEscape();
      // overlays that don't listen for Escape: click their backdrop
      setTimeout(() => {
        if (hasOpenOverlay() === overlay) {
          overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      }, 60);
      return;
    }
    if (window.__sbNav?.back?.()) return;
    const now = Date.now();
    if (now - lastBack < 2000) {
      CapApp.minimizeApp();
    } else {
      lastBack = now;
      toast("Press back again to exit");
    }
  });
  CapApp.addListener("pause", () => fire("app-pause"));
}

function toast(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom));transform:translateX(-50%);" +
    "background:#222;color:#f0f0f0;border:1px solid #2a2a2a;padding:10px 16px;border-radius:20px;" +
    "font:500 13px 'DM Sans',sans-serif;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s";
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 250); }, 1600);
}

// App-own links with target=_blank → system browser (WebView popups are blocked)
document.addEventListener(
  "click",
  (e) => {
    const a = e.target?.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    let url;
    try { url = new URL(href, location.href); } catch { return; }
    if (url.origin === location.origin) return;
    e.preventDefault();
    P.openExternal({ url: url.href }).catch(() => {});
  },
  true,
);

// ── progress query in nested frames (desktop: query-video-progress) ─────────
const PROGRESS_JS = `(() => {
  const P = window.meinecloudPlayer;
  if (P && typeof P.getCurrentTime === 'function') {
    try {
      const t = P.getCurrentTime(), d = P.getDuration(), paused = P.getPaused();
      if (typeof t === 'number' && typeof d === 'number' && typeof paused === 'boolean') {
        if (!(d > 0) || d === Infinity || paused) return null;
        return { currentTime: t, duration: d, recentUserSeek: false, lastUserSeekTo: null };
      }
    } catch (e) {}
  }
  const v = document.querySelector('video');
  if (!v || !v.duration || v.duration === Infinity || v.paused) return null;
  if (!v._seekTracked) {
    v._seekTracked = true;
    v.addEventListener('seeked', () => { v._lastUserSeek = Date.now(); v._lastUserSeekTo = v.currentTime; });
  }
  return {
    currentTime: v.currentTime, duration: v.duration,
    recentUserSeek: v._lastUserSeek ? (Date.now() - v._lastUserSeek < 6000) : false,
    lastUserSeekTo: v._lastUserSeekTo ?? null,
  };
})()`;

const ok = (extra = {}) => ({ ok: true, ...extra });
const safe = (fn, fallback) => async (...a) => {
  try { return await fn(...a); } catch (e) { return fallback ?? { ok: false, error: String(e?.message || e) }; }
};

const cleanUA = navigator.userAgent.replace("; wv)", ")");

const electron = {
  cleanUserAgent: cleanUA,
  isMobile: true,

  onM3u8Found: (cb) => on("m3u8-found", cb),
  offM3u8Found: (h) => off("m3u8-found", h),
  onSubtitleFound: (cb) => on("subtitle-found", cb),
  offSubtitleFound: (h) => off("subtitle-found", h),
  onDownloadProgress: (cb) => on("download-progress", cb),
  offDownloadProgress: (h) => off("download-progress", h),

  // ── downloads ──
  checkDownloader: async () => ({ exists: true, token: "android-native" }),
  runDownload: safe(async (args) => {
    await pathsReady;
    const full = await (await import("./smartDownloads.js")).storageLimitReached();
    if (full) return { ok: false, error: full };
    const headers = {};
    const referer = hianime.hianimeReferers.get(args.m3u8Url);
    const fm = frameStreamMeta.get(args.m3u8Url);
    if (referer) {
      headers.Referer = referer;
      try { headers.Origin = new URL(referer).origin; } catch {}
    } else if (fm) {
      if (fm.referer) headers.Referer = fm.referer;
      if (fm.origin) headers.Origin = fm.origin;
    }
    const fallbackUrl = fm?.media || null;
    const res = await P.startDownload({ ...args, headers, fallbackUrl });
    return res;
  }),
  getDownloads: async () => {
    const list = await native.getDownloads();
    return list.map((d) => { const c = { ...d }; delete c._dir; return c; });
  },
  deleteDownload: safe(async ({ id, filePath }) => {
    await P.deleteDownload({ id, deleteFiles: !!filePath });
    return ok();
  }),
  deleteAllDownloads: safe(() => P.deleteAllDownloads()),
  pauseDownload: safe((id) => P.pauseDownload({ id })),
  captureStream: (url, timeout) => captureStream(url, timeout),
  // "" when cancelled; throws when the device has no voice input
  voiceSearch: async () => (await P.voiceSearch({ prompt: "Say a movie or show" }))?.text || "",
  resumeDownload: safe((id) => P.resumeDownload({ id })),
  getDownloadsSize: safe(() => P.getDownloadsSize(), { bytes: 0 }),
  scheduleReminders: (items) => P.scheduleReminders({ items: items || [] }),
  // Trakt requests go through the native side (no CORS); only Trakt (or a local test server)
  traktFetch: async ({ method, url, headers, body }) => {
    const test = localStorage.getItem("__sb_trakt_api");
    if (!String(url).startsWith("https://api.trakt.tv/") && !(test && String(url).startsWith(test))) throw new Error("blocked");
    const r = await native.http({ url, method: method || "GET", headers: headers || {}, body, timeout: 20000 });
    return { status: r.status, data: r.data };
  },
  shareImage: async ({ dataUrl, name, text }) => {
    const b64 = String(dataUrl).split(",")[1] || "";
    return P.shareImage({ base64: b64, name: name || "streambert.png", text: text || "" });
  },
  shareText: async ({ text, title }) => P.shareText({ text: String(text || ""), title: title || "Share" }),
  verifyUser: async (title) => !!(await P.verifyUser({ title: title || "Vidra" }))?.ok,
  networkInfo: async () => {
    try {
      return await P.networkInfo();
    } catch {
      return { connected: true, unmetered: false };
    }
  },
  showInFolder: async (path) => {
    if (path) await P.openInPlayer({ url: path, title: "" });
  },
  fileExists: async (path) => {
    if (!path) return false;
    try { return (await P.fileExists({ path })).exists; } catch { return false; }
  },
  scanDirectory: safe(async (path) => (await P.scanDirectory({ path })).files || [], []),
  pickFolder: async () => (await pathsReady).downloads || null,
  openExternal: async (url) => {
    try { await P.openExternal({ url }); } catch {}
  },
  openPath: async (filePath) => {
    if (!filePath) return;
    if (/\.(log|txt)$/i.test(filePath)) return;
    const d = await downloadFor(filePath);
    openLocalPlayer({ filePath, seconds: 0, subtitlePaths: d?.subtitlePaths || [], title: d?.name || "", media: mediaOf(d) });
  },
  openPathAtTime: async (filePath, seconds, subtitlePaths) => {
    const d = await downloadFor(filePath);
    openLocalPlayer({
      filePath,
      seconds,
      subtitlePaths: subtitlePaths?.length ? subtitlePaths : d?.subtitlePaths || [],
      title: d?.name || "",
      media: mediaOf(d),
    });
  },
  getInstallPath: async () => (await pathsReady).files,
  openStreamExternal: safe(async ({ url, title }) => {
    return P.openInPlayer({ url, title: title || "Vidra" });
  }),
  pruneSubtitlePaths: safe((id) => subs.pruneSubtitlePaths(id)),

  // close confirmation: Android apps don't get a close event
  onConfirmClose: (cb) => on("confirm-close", cb),
  offConfirmClose: (h) => off("confirm-close", h),
  respondClose: () => {},

  // ── anime ──
  resolveHiAnime: (args) => hianime.resolveHiAnime(args),
  setPlayerVideo: (args) => {
    if (args?.url) lastStreamUrl = args.url;
    return hianime.setPlayerVideo(args);
  },
  onHiAnimeProgress: (cb) => hianime.onHiAnimeProgress(cb),
  debugHiAnime: (args) => hianime.debugHiAnime(args),

  getAppVersion: async () => (await pathsReady).version || "2.7.0",

  onWebviewEnterFullscreen: (cb) => on("webview-enter-fullscreen", cb),
  offWebviewEnterFullscreen: (h) => off("webview-enter-fullscreen", h),
  onWebviewLeaveFullscreen: (cb) => on("webview-leave-fullscreen", cb),
  offWebviewLeaveFullscreen: (h) => off("webview-leave-fullscreen", h),

  onBlockedUpdate: (cb) => on("blocked-stats-update", cb),
  offBlockedUpdate: (h) => off("blocked-stats-update", h),
  getBlockStats: safe(() => P.getBlockStats(), { total: 0, domains: {} }),

  showNotification: async ({ title, body, url }) => {
    try { await P.showNotification({ title: String(title), body: String(body), url: url || null }); } catch {}
  },
  quitApp: async () => { try { await P.exitApp(); } catch {} },
  playerStopped: () => {
    try { P.exitFullscreen(); } catch {}
  },

  // ── storage cleaning ──
  getCacheSize: safe(() => P.getCacheSize(), { bytes: 0 }),
  clearAppCache: safe(() => P.clearCache()),
  clearWatchData: safe(() => P.clearCookies()),
  resetApp: safe(async () => {
    await P.clearDownloadRegistry();
    await P.clearCookies();
    await P.clearCache();
    return ok();
  }),
  queryVideoProgress: async (webContentsId) => {
    const el = frameById(webContentsId);
    if (!el) return null;
    try { return await execInFrame(el, PROGRESS_JS, { deep: true, timeout: 2000 }); } catch { return null; }
  },

  // ── subtitles ──
  searchSubtitles: safe((a) => subs.searchSubtitles(a)),
  getSubtitleUrl: safe((a) => subs.getSubtitleUrl(a)),
  downloadSubtitlesForFile: safe((a) => subs.downloadSubtitlesForFile(a)),
  deleteSubtitleFile: safe((a) => subs.deleteSubtitleFile(a)),

  // Wyzie key: there is no embedded redeem window on Android → open the site
  wyzieOpenRedeem: async () => {
    try { await P.openExternal({ url: "https://sub.wyzie.io/redeem" }); } catch {}
    return { cancelled: true };
  },
  wyzieValidateKey: async (key) => {
    if (!key || key.length < 8) return { ok: false, error: "Invalid key" };
    return { ok: true };
  },

  // ── secure storage (app-private storage on Android) ──
  secureGet: async (key) => {
    try { return localStorage.getItem("__secure_" + key); } catch { return null; }
  },
  secureSet: async (key, value) => {
    try {
      if (value) localStorage.setItem("__secure_" + key, value);
      else localStorage.removeItem("__secure_" + key);
      return ok();
    } catch (e) { return { ok: false, error: e.message }; }
  },

  // ── pop-out (PiP window) - not available, embedded players have their own PiP ──
  // Pop-out button → Android picture-in-picture
  openPipWindow: async () => enterPip(),
  closePipWindow: async () => {},
  getPipWebContentsId: async () => null,
  onPipOpened: (cb) => on("pip-opened", cb),
  offPipOpened: (h) => off("pip-opened", h),
  onPipClosed: (cb) => on("pip-closed", cb),
  offPipClosed: (h) => off("pip-closed", h),

  // ── window controls (no-ops) ──
  windowMinimize: async () => { try { await CapApp.minimizeApp(); } catch {} },
  windowToggleMaximize: async () => {},
  windowClose: async () => {},
  windowIsMaximized: async () => true,
  getPlatform: async () => "ios",
  onWindowMaximize: (cb) => on("window-maximized", cb),
  offWindowMaximize: (h) => off("window-maximized", h),

  getVideoDuration: safe(async (path) => (await P.getVideoDuration({ path })).seconds, null),
  setZoomFactor: (factor) => {
    document.documentElement.style.zoom = String(factor);
  },

  // ── updates: .ipa from github.com/SoloHandCoder/vidra-ios releases (opens the release page) ──
  detectUpdateFormat: async () => "ipa",
  downloadAndInstallUpdate: safe(async ({ url }) => P.installUpdate({ url })),
  cancelUpdate: async () => { try { await P.cancelUpdate(); } catch {} },
  onUpdateProgress: (cb) => on("update-progress", cb),
  offUpdateProgress: (h) => off("update-progress", h),

  // ── scheduled backups ──
  getScheduledBackupSettings: async () =>
    getLS("__scheduledBackup") || { enabled: false, path: "", keepCount: 5, frequency: "startup", lastRun: null },
  setScheduledBackupSettings: async (settings) => { setLS("__scheduledBackup", settings); return ok(); },
  performScheduledBackup: safe(async ({ data, settings }) => {
    const dir = settings?.path || (await pathsReady).downloads;
    if (!dir) return { ok: false, error: "No backup path set" };
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = `${dir.replace(/\/+$/, "")}/streambert-backup-${ts}.json`;
    await native.writeFile({
      path,
      data: JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), scheduledBackup: true, data }, null, 2),
      encoding: "utf8",
    });
    setLS("__scheduledBackup", { ...settings, lastRun: new Date().toISOString() });
    return ok({ path });
  }),
  onScheduledBackupRequested: (cb) => on("scheduled-backup-requested", cb),
  offScheduledBackupRequested: (h) => off("scheduled-backup-requested", h),

  fetchReleaseImage: safe(async (url) => {
    const res = await native.http({ url, responseType: "base64" });
    const ct = res.headers["content-type"] || "image/png";
    if (!/^image\//.test(ct)) return null;
    return `data:${ct};base64,${res.data}`;
  }, null),

  // Chromecast (mobile only)
  castAvailable: async () => {
    try { return !!(await castAvailable()); } catch { return false; }
  },
  castStream: (opts) => castStream(opts),
  stopCast: async () => { try { await stopCast(); } catch {} },
  onCastState: (cb) => onCastState(cb),

  // Discord RPC: desktop only
  discordRpcSetEnabled: async () => ({ ok: false }),
  discordRpcUpdateActivity: async () => ({ ok: false }),
};

if (isNative) {
  if (window.__sbElectron) Object.assign(window.__sbElectron, electron);
  else window.electron = electron;
  document.documentElement.setAttribute("data-mobile", "1");
  document.documentElement.setAttribute("data-platform", "ios");
  // scheduled backup check on start (desktop main process does this after load)
  setTimeout(async () => {
    const s = await electron.getScheduledBackupSettings();
    if (!s?.enabled || !s?.path) return;
    const diff = s.lastRun ? Date.now() - new Date(s.lastRun).getTime() : Infinity;
    const due =
      s.frequency === "startup" ||
      (s.frequency === "daily" && diff >= 86_400_000) ||
      (s.frequency === "weekly" && diff >= 604_800_000) ||
      (s.frequency === "monthly" && diff >= 2_592_000_000);
    if (due) fire("scheduled-backup-requested");
  }, 2500);
}

export { fileSrc };
