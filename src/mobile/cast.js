// Chromecast wrapper around the native "StreambertCast" plugin (android/.../CastPlugin.java).
// Media is served to the Chromecast by the phone's LAN server, so phone and TV must share a network.
import { registerPlugin } from "@capacitor/core";

const Cast = registerPlugin("StreambertCast");

/** true when Google Play services + the Cast framework are present (false on Fire TV / Huawei / web). */
export async function castAvailable() {
  try {
    const r = await Cast.isAvailable();
    return !!r?.available;
  } catch {
    return false;
  }
}

/**
 * Cast a stream or a downloaded file. Shows the device picker if no session is connected yet.
 * @param {{ url: string, title?: string, referer?: string, startTime?: number,
 *           subtitleUrl?: string, isLocal?: boolean }} opts
 *   url: remote http(s) URL (m3u8 / mp4) or absolute local path (mp4 file or HLS index.m3u8 / its folder)
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function castMedia(opts) {
  try {
    return await Cast.cast(opts);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Ends the current cast session. */
export async function stopCast() {
  try {
    await Cast.stop();
  } catch {}
}

/** @returns {Promise<{ connected: boolean, deviceName: string | null }>} */
export async function getCastState() {
  try {
    return await Cast.getState();
  } catch {
    return { connected: false, deviceName: null };
  }
}

/**
 * Subscribe to { connected, deviceName } changes. Returns an unsubscribe function.
 * @param {(state: { connected: boolean, deviceName: string | null }) => void} cb
 */
export function onCastState(cb) {
  let handle = null;
  let removed = false;
  Promise.resolve(Cast.addListener("castState", cb))
    .then((h) => {
      handle = h;
      if (removed) h?.remove?.();
    })
    .catch(() => {});
  return () => {
    removed = true;
    try { handle?.remove?.(); } catch {}
  };
}
