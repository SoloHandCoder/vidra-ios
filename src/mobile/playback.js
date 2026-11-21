// Playback integration with Android:
//  - reports the active video (embedded player / in-app player) to the native
//    media session → lock-screen + notification controls, headset buttons
//  - enables picture-in-picture while something plays, and lays the page out
//    as "video only" while in PiP
//  - executes media commands (play/pause/seek) inside the player frame
//  - handles the in-app player's brightness / volume / pip / cast requests
import { native, isNative } from "./native.js";
import { allFrames, execInFrame } from "./MobileWebView.jsx";
import { trackWatchSecond } from "./libraryExtras.js";
import { traktScrobble } from "./trakt.js";
import { reportPlayer, setPartyPlayer } from "./party.js";

const P = native.plugin;

const STATE_JS = `(() => {
  const v = document.querySelector('video');
  if (!v || !(v.duration > 0)) return null;
  return { t: v.currentTime, d: v.duration === Infinity ? 0 : v.duration, paused: v.paused,
           w: v.videoWidth || 16, h: v.videoHeight || 9 };
})()`;

const cmdJs = (body) => `(() => { const v = document.querySelector('video'); if (!v) return null; ${body}; return true; })()`;

function localPlayerFrame() {
  return document.querySelector("iframe[data-sb-local-player]");
}

/** The iframe that currently holds the video we control. */
function activeFrame() {
  const local = localPlayerFrame();
  if (local) return local;
  const frames = allFrames().filter((f) => {
    const src = f.getAttribute("src") || "";
    return src && src !== "about:blank" && f.offsetWidth > 0;
  });
  return frames[frames.length - 1] || null;
}

function currentTitle(frame) {
  if (frame?.hasAttribute("data-sb-local-player")) {
    try {
      return new URL(frame.src).searchParams.get("title") || "Vidra";
    } catch {}
  }
  const t = document.querySelector(".main .detail-title")?.textContent?.trim();
  return t || "Vidra";
}

function currentSubtitle() {
  // TV page: active episode label if present
  const ep = document.querySelector(".episode-item.active .episode-title, .ep-card--active .ep-card__title");
  return ep?.textContent?.trim() || "Vidra";
}

let last = { active: false, playing: false };
let curT = 0; // the player's position at the last poll

// The subtitle style chosen in the built-in player also applies (best effort)
// to other sources' players that render standard <track> subtitles.
let styledFrame = null, styledSig = "";
function cueCss() {
  let st = {};
  try { st = JSON.parse(localStorage.getItem("streambert_subtitleStyle") || "{}"); } catch {}
  const size = { s: 0.85, m: 1.05, l: 1.35, xl: 1.7 }[st.size] || null;
  if (!size && !st.color && !st.bg) return "";
  const bg = st.bg === "none" ? "transparent" : st.bg === "solid" ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.62)";
  return `video::cue{font-size:${size || 1.05}em!important;color:${st.color || "#fff"}!important;background:${bg}!important;` +
    (st.bg === "none" ? "text-shadow:0 0 3px #000,0 0 3px #000,1px 1px 2px #000!important;" : "") + "}";
}
async function styleEmbedded(frame) {
  if (!frame || frame.hasAttribute("data-sb-local-player")) return;
  const src = frame.getAttribute("src") || "";
  if (src.includes("/sb-player.html")) return; // our own player styles itself
  const css = cueCss();
  const sig = src + "|" + css;
  if (!css || (frame === styledFrame && sig === styledSig)) return;
  styledFrame = frame;
  styledSig = sig;
  // returns null on purpose so the bridge also walks into nested frames
  const js = `(() => { let el = document.getElementById("sb-cue-style");
    if (!el) { el = document.createElement("style"); el.id = "sb-cue-style"; (document.head || document.documentElement).appendChild(el); }
    el.textContent = ${JSON.stringify(css)}; return null; })()`;
  try { await execInFrame(frame, js, { deep: true, timeout: 2500 }); } catch {}
}
// which title is playing (for watch statistics)
function watchInfo(frame) {
  if (frame?.hasAttribute("data-sb-local-player")) {
    try { return JSON.parse(frame.getAttribute("data-sb-media") || "null"); } catch { return null; }
  }
  if (!frame?.closest?.(".player-wrap")) return null; // trailers etc. don't count
  const sel = window.__sbNav?.selected?.();
  if (!sel?.id) return null;
  const page = window.__sbNav?.page?.();
  const media_type = page === "tv" || page === "movie" ? page : sel.media_type;
  if (!media_type) return null;
  return {
    id: sel.id,
    media_type,
    title: sel.title || sel.name || "",
    poster_path: sel.poster_path || null,
    genres: (sel.genres || []).map((g) => g?.name).filter(Boolean),
  };
}
let intercepting = false;
let lastFrame = null;
let pip = false;

let polling = false;
async function poll() {
  if (polling) return; // the previous check is still waiting on a slow player frame
  if (document.hidden && !last.playing) return; // in the background with nothing playing
  polling = true;
  try {
    await pollOnce();
  } finally {
    polling = false;
  }
}

async function pollOnce() {
  const frame = activeFrame();
  let state = null;
  if (frame) {
    try {
      state = await execInFrame(frame, STATE_JS, { deep: true, timeout: 1500 });
    } catch {}
  }
  lastFrame = state ? frame : null;
  curT = state?.t || 0;
  lastState = state ? { t: state.t || 0, d: state.d || 0, playing: !state.paused, at: Date.now() } : null;
  if (state) styleEmbedded(frame);
  // in-app fullscreen only for the Movie/TV page player
  const want = !!frame?.closest?.(".player-wrap");
  if (want !== intercepting) {
    intercepting = want;
    P.setInterceptFullscreen({ on: want }).catch(() => {});
    // left the player page while it was fullscreen → restore bars/orientation
    if (!want && !localPlayerFrame()) {
      document.documentElement.removeAttribute("data-player-fullscreen");
      P.setFullscreen({ on: false }).catch(() => {});
    }
  }
  const active = !!state;
  const playing = active && !state.paused;
  if (playing) {
    const info = watchInfo(frame);
    if (info) trackWatchSecond(info);
  }
  // watch party: what's open / playing here
  {
    let pm = active ? watchInfo(frame) : null;
    if (!pm) {
      const sel = window.__sbNav?.selected?.();
      const pg = window.__sbNav?.page?.();
      if (sel?.id && (pg === "movie" || pg === "tv")) pm = { id: sel.id, media_type: pg, title: sel.title || sel.name || "" };
    }
    const epw = window.__sbNav?.watching?.();
    if (pm && pm.media_type === "tv") pm = { ...pm, season: epw?.season, episode: epw?.episode };
    reportPlayer(pm ? { id: pm.id, media_type: pm.media_type, title: pm.title, season: pm.season, episode: pm.episode } : null, active ? { playing, t: state.t || 0 } : null);
  }
  if (active) {
    const info = watchInfo(frame);
    const ep = window.__sbNav?.watching?.();
    if (info) traktScrobble({ ...info, season: ep?.season, episode: ep?.episode }, state.d ? (state.t / state.d) * 100 : 0, playing);
  }
  const payload = active
    ? {
        active,
        playing,
        title: currentTitle(frame),
        subtitle: currentSubtitle(),
        position: state.t || 0,
        duration: state.d || 0,
        aspect: state.w && state.h ? state.w / state.h : 16 / 9,
      }
    : { active: false, playing: false };
  // only talk to native when something changed (position updates every 5s)
  const now = Date.now();
  if (
    payload.active !== last.active ||
    payload.playing !== last.playing ||
    payload.title !== last.title ||
    (active && now - (last.at || 0) > 5000)
  ) {
    last = { ...payload, at: now };
    try { await P.setPlaybackState(payload); } catch {}
  }
}

// where the player is + jump to a time (used by "Skip intro"), for any source
let lastState = null;
window.__sbPlayerState = () => (lastState && Date.now() - lastState.at < 3500 ? lastState : null);
window.__sbSeekPlayer = (t) => command("seek", t);

// watch party: follow what the others do
setPartyPlayer(async ({ playing, t }) => {
  if (Math.abs(curT - t) > 2) await command("seek", t);
  await command(playing ? "play" : "pause");
});

async function command(cmd, value) {
  const frame = lastFrame || activeFrame();
  if (!frame) return;
  let js;
  if (cmd === "play") js = cmdJs("v.play()");
  else if (cmd === "pause") js = cmdJs("v.pause()");
  else if (cmd === "seek") js = cmdJs(`v.currentTime = ${Number(value) || 0}`);
  else if (cmd === "skip") js = cmdJs(`v.currentTime = Math.max(0, v.currentTime + (${Number(value) || 0}))`);
  if (!js) return;
  try {
    await execInFrame(frame, js, { deep: true, timeout: 1500 });
  } catch {}
  setTimeout(poll, 300);
}

function setPipLayout(on) {
  pip = on;
  const root = document.documentElement;
  document.querySelectorAll("[data-sb-pip-target]").forEach((el) => el.removeAttribute("data-sb-pip-target"));
  if (on) {
    const f = lastFrame || activeFrame();
    if (f) f.setAttribute("data-sb-pip-target", "1");
    root.setAttribute("data-pip", "1");
  } else {
    root.removeAttribute("data-pip");
  }
}

export function enterPip() {
  return P.enterPip().catch(() => ({ ok: false }));
}

/** cast handler is installed by electronShim (needs stream referer info) */
let castHandler = null;
export function setCastHandler(fn) {
  castHandler = fn;
}

if (isNative) {
  setInterval(poll, 1000);
  native.on("mediaCommand", (d) => command(d.cmd, d.value));
  native.on("pip", (d) => setPipLayout(!!d.value));

  // messages from the in-app player page (public/sb-player.html)
  window.addEventListener("message", async (ev) => {
    const d = ev.data;
    if (!d || d.__sb !== "player") return;
    const reply = (msg) => {
      try { ev.source?.postMessage(msg, "*"); } catch {}
    };
    switch (d.cmd) {
      case "brightness":
        P.setBrightness({ value: Number(d.value) }).catch(() => {});
        break;
      case "volume":
        P.setVolume({ value: Number(d.value) }).catch(() => {});
        break;
      case "getLevels":
        try {
          const l = await P.getLevels();
          reply({ __sb: "playerLevels", brightness: l.brightness, volume: l.volume });
        } catch {
          reply({ __sb: "playerLevels", brightness: 0.5, volume: 1 });
        }
        break;
      case "pip":
        enterPip();
        break;
      case "cast": {
        // which frame asked? local player → its file; embedded → current stream
        const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === ev.source);
        castHandler?.({ frame, t: Number(d.t) || 0 });
        break;
      }
    }
  });

  // Leaving the player → screen brightness back to the system value
  const restoreBrightness = () => P.setBrightness({ value: -1 }).catch(() => {});
  window.addEventListener("sb:local-player-closed", restoreBrightness);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });
}

export function getPlaybackState() {
  return { ...last, pip };
}
