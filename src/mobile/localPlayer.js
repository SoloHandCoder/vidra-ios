// Full-screen in-app player for downloaded files (desktop opens VLC/mpv instead).
// Shows public/sb-player.html in an overlay iframe; that page plays local HLS
// folders (index.m3u8 + segments) with hls.js and mp4 natively.
import { Capacitor } from "@capacitor/core";
import { native, fileSrc } from "./native.js";

const P = native.plugin;
const POS_PREFIX = "streambert_localPos_";

let current = null;

function savePos(key, t, d) {
  if (!key || !(t > 0)) return;
  try {
    localStorage[POS_PREFIX + key] = JSON.stringify({ t, d: d > 0 ? d : 0, at: Date.now() });
  } catch {}
}

function savedResume(key) {
  try {
    const p = JSON.parse(localStorage[POS_PREFIX + key] || "null");
    const t = Number(p?.t) || 0;
    const d = Number(p?.d) || 0;
    if (t > 10 && (!d || t < d - 30)) return Math.floor(t);
  } catch {}
  return 0;
}

function onMessage(e) {
  if (!current || e.source !== current.frame.contentWindow) return;
  const d = e.data;
  if (!d || typeof d !== "object" || d.__sb !== "player") return;
  if (d.cmd === "close") closeLocalPlayer();
  else if (d.cmd === "position") savePos(current.key, Number(d.t) || 0, Number(d.d) || 0);
  // brightness / volume / getLevels / cast / pip are handled globally elsewhere.
}

export function closeLocalPlayer() {
  if (!current) return false;
  const { root, frame, key } = current;
  // Final position straight from the (same-origin) iframe's <video>.
  try {
    const v = frame.contentDocument?.querySelector("video");
    if (v) {
      savePos(key, v.currentTime || 0, v.duration || 0);
      v.pause();
    }
  } catch {}
  window.removeEventListener("message", onMessage);
  current = null;
  try { frame.src = "about:blank"; } catch {}
  root.remove();
  try { P.setFullscreen({ on: false }); } catch {}
  try { P.setKeepScreenOn({ on: false }); } catch {}
  return true;
}
window.__sbLocalPlayerClose = closeLocalPlayer;

// iOS: downloaded HLS folders play in iOS's own player (StreambertPlugin.playLocal);
// the web view can't reliably play a local HLS playlist. Falls back to the
// in-app player below if the native player isn't available.
const IOS = Capacitor.getPlatform() === "ios";

async function openNativePlayer({ filePath, seconds = 0, subtitlePaths = [], title = "", media = null }) {
  const key = String(filePath || "");
  const start = seconds > 0 ? seconds : savedResume(key);
  const subtitles = (subtitlePaths || [])
    .filter((s) => s?.path && /\.(vtt|srt)$/i.test(s.path))
    .map((s, i) => ({ path: s.path, lang: (s.lang || "und").slice(0, 8), label: s.label || s.lang || `Subtitle ${i + 1}` }));
  const r = await P.playLocal({ path: key, title, start: Math.floor(start), subtitles });
  if (!r?.ok) throw new Error(r?.error || "native player failed");
  savePos(key, Number(r.position) || 0, Number(r.duration) || 0);
  const secs = Math.min(Number(r.watched) || 0, 86400);
  if (media && secs > 0) {
    try {
      const { trackWatchSecond, flushStats } = await import("./libraryExtras.js");
      for (let i = 0; i < secs; i++) trackWatchSecond(media);
      flushStats();
    } catch {}
  }
}

export function openLocalPlayer(opts) {
  if (IOS && /\.m3u8$/i.test(String(opts?.filePath || ""))) {
    closeLocalPlayer();
    openNativePlayer(opts).catch(() => openWebPlayer(opts));
    return;
  }
  openWebPlayer(opts);
}

function openWebPlayer({ filePath, seconds = 0, subtitlePaths = [], title = "", media = null }) {
  closeLocalPlayer();
  const key = String(filePath || "");
  const start = seconds > 0 ? seconds : savedResume(key);

  const subs = [];
  for (const [i, s] of (subtitlePaths || []).entries()) {
    if (!s?.path || !/\.(vtt|srt)$/i.test(s.path)) continue; // the player converts SRT → VTT
    subs.push({
      url: fileSrc(s.path),
      label: s.label || s.lang || `Subtitle ${i + 1}`,
      lang: (s.lang || "und").slice(0, 8),
    });
  }

  const p = new URLSearchParams();
  p.set("src", fileSrc(filePath));
  if (title) p.set("title", title);
  if (start > 0) p.set("t", String(Math.floor(start)));
  p.set("close", "1");
  p.set("cast", "1");
  if (subs.length) p.set("subs", JSON.stringify(subs));
  p.set("key", key);

  const root = document.createElement("div");
  root.className = "sb-local-player";
  root.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:#000";
  const frame = document.createElement("iframe");
  frame.src = `/sb-player.html?${p.toString()}`;
  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("data-sb-local-player", "");
  if (media) frame.setAttribute("data-sb-media", JSON.stringify(media));
  frame.title = title || "Player";
  frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#000";
  // Give the player keyboard / D-pad focus once it has loaded.
  frame.addEventListener("load", () => {
    try { frame.focus(); frame.contentWindow?.focus(); } catch {}
  });
  root.appendChild(frame);
  document.body.appendChild(root);

  current = { root, frame, key };
  window.addEventListener("message", onMessage);
  try { P.setFullscreen({ on: true }); } catch {}
  try { P.setKeepScreenOn({ on: true }); } catch {}
}
