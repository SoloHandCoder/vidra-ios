// Continue on another device: while you watch, this device saves where you are
// ("lastPlayed", synced with cloud sync). When another device picks that up,
// it offers to continue at the same second.
import { storage } from "../utils/storage";

export const LAST_PLAYED = "lastPlayed";

export function deviceId() {
  let id = null;
  try {
    id = localStorage.getItem("__sb_device_id");
    if (!id) {
      id = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem("__sb_device_id", id);
    }
  } catch {}
  return id || "unknown";
}

export function deviceName() {
  const ua = navigator.userAgent || "";
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux|X11/.test(ua)) return "Linux PC";
  return "other device";
}

let lastWrite = 0;
let wasPlaying = false;
/** called about once a second by the player with what's playing */
export function noteWatching(media, st) {
  if (!media?.id || !st || !(st.d > 0) || !(st.t >= 0)) return;
  const now = Date.now();
  const paused = wasPlaying && !st.playing; // write right away when you pause
  wasPlaying = !!st.playing;
  if (!paused && (!st.playing || now - lastWrite < 15000)) return;
  lastWrite = now;
  storage.set(LAST_PLAYED, {
    id: media.id,
    media_type: media.media_type,
    title: media.title || "",
    poster_path: media.poster_path || null,
    season: media.season ?? null,
    episode: media.episode ?? null,
    t: Math.floor(st.t),
    d: Math.floor(st.d),
    at: now,
    device: deviceId(),
    deviceName: deviceName(),
  });
}

/** something from another device worth continuing here, or null */
export function handoffCandidate() {
  const v = storage.get(LAST_PLAYED);
  if (!v?.id || v.device === deviceId()) return null;
  let seen = 0;
  try {
    seen = Number(localStorage.getItem("__sb_handoff_seen") || 0);
  } catch {}
  if (!(v.at > seen) || Date.now() - v.at > 12 * 3600e3) return null;
  if (!(v.t > 30) || (v.d && v.d - v.t < 90)) return null; // barely started / basically finished
  return v;
}

export function dismissHandoff(v) {
  try {
    localStorage.setItem("__sb_handoff_seen", String(v?.at || Date.now()));
  } catch {}
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(ss).padStart(2, "0");
};
