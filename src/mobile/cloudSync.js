// Cloud sync through a private (secret) GitHub Gist.
//
// Gist "Streambert sync" contains:
//   streambert-sync.json   { app, version, updatedAt, profiles: [...], deleted: [...] }
//   profile-<id>.json      { version, updatedAt, profile: {id,name,color}, data: { saved, history, progress, watched, … } }
// Plain JSON on purpose, so other Streambert apps (e.g. the desktop) can use the same Gist.
//
// The GitHub token (needs only the "gist" permission) stays on this device.
import { native } from "./native.js";
import { mergeProfile, mergeProfileList, same } from "./syncMerge.js";
import { getMeta, readProfileData, writeProfileData, applyProfileList } from "./profiles.js";

const API = () => localStorage.getItem("__sb_sync_api") || "https://api.github.com"; // overridable for tests
const DESC = "Streambert sync";
const INDEX = "streambert-sync.json";
const TOKEN_KEY = "__secure_githubSyncToken";
const STATE_KEY = "__sb_sync";
const BASE = (id) => `__sb_sync_base_${id}`;
const AUTO_MS = 5 * 60 * 1000;
const DEVICE_ONLY = ["localPos_"];

const listeners = new Set();
let running = null;

function state() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
  } catch {
    return {};
  }
}
function setState(patch) {
  const s = { ...state(), ...patch };
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  listeners.forEach((cb) => cb(getStatus()));
  return s;
}
const token = () => localStorage.getItem(TOKEN_KEY) || "";

export function getStatus() {
  const s = state();
  return {
    connected: !!token() && !!s.login,
    login: s.login || null,
    gistId: s.gistId || null,
    lastSync: s.lastSync || null,
    lastError: s.lastError || null,
    auto: s.auto !== false,
    syncing: !!running,
  };
}
export function onStatus(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function gh(path, { method = "GET", body, tok = token() } = {}) {
  const res = await native.http({
    url: API() + path,
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Streambert-Android",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    timeout: 20000,
  });
  let data = null;
  try {
    data = res.data ? JSON.parse(res.data) : null;
  } catch {}
  if (res.status === 401) throw new Error("GitHub rejected the token (expired or revoked).");
  if (res.status === 403 || res.status === 404) {
    const scopes = res.headers?.["x-oauth-scopes"];
    if (scopes != null && !String(scopes).includes("gist")) throw new Error('The token needs the "gist" permission.');
  }
  if (res.status >= 400) throw new Error(data?.message ? `GitHub: ${data.message}` : `GitHub error ${res.status}`);
  return { data, headers: res.headers || {} };
}

/** Checks the token and remembers the account. Finds an existing sync Gist if there is one. */
export async function connect(tok) {
  tok = String(tok || "").trim();
  if (!tok) throw new Error("Paste a GitHub token first.");
  const { data: user, headers } = await gh("/user", { tok });
  const scopes = headers["x-oauth-scopes"];
  if (scopes != null && scopes !== "" && !String(scopes).split(/,\s*/).includes("gist")) {
    throw new Error('This token is missing the "gist" permission.');
  }
  localStorage.setItem(TOKEN_KEY, tok);
  let gistId = null;
  for (let page = 1; page <= 5 && !gistId; page++) {
    const { data: gists } = await gh(`/gists?per_page=100&page=${page}`);
    if (!Array.isArray(gists) || !gists.length) break;
    const hit = gists.find((g) => g.description === DESC && g.files?.[INDEX]);
    if (hit) gistId = hit.id;
  }
  setState({ login: user?.login || "GitHub", gistId, lastError: null });
  return syncNow();
}

export function disconnect() {
  localStorage.removeItem(TOKEN_KEY);
  const m = getMeta();
  for (const p of m.list) localStorage.removeItem(BASE(p.id));
  localStorage.removeItem(STATE_KEY);
  listeners.forEach((cb) => cb(getStatus()));
}

export function setAuto(v) {
  setState({ auto: !!v });
}

async function readGist(id) {
  const { data } = await gh(`/gists/${id}`);
  const files = {};
  for (const [name, f] of Object.entries(data?.files || {})) {
    let content = f.content;
    if (f.truncated && f.raw_url) {
      const raw = await native.http({ url: f.raw_url, headers: { Authorization: `Bearer ${token()}` }, timeout: 30000 });
      content = raw.data;
    }
    try {
      files[name] = JSON.parse(content);
    } catch {}
  }
  return files;
}

/** One full sync of every profile. Safe to call often (does nothing while a sync runs). */
export function syncNow() {
  if (running) return running;
  if (!token()) return Promise.resolve(getStatus());
  running = doSync()
    .then(() => setState({ lastSync: Date.now(), lastError: null }))
    .catch((e) => setState({ lastError: String(e?.message || e) }))
    .finally(() => {
      running = null;
      listeners.forEach((cb) => cb(getStatus()));
    });
  listeners.forEach((cb) => cb(getStatus()));
  return running;
}

async function doSync() {
  const st = state();
  let remote = {};
  if (st.gistId) {
    try {
      remote = await readGist(st.gistId);
    } catch (e) {
      if (/Not Found|404/.test(String(e?.message))) setState({ gistId: null });
      else throw e;
    }
  }
  const meta = getMeta();
  const localIndex = {
    profiles: meta.list.map(({ id, name, color, editedAt, kids, ageLimit }) => ({ id, name, color, editedAt, ...(kids ? { kids: true, ageLimit } : {}) })),
    deleted: meta.deleted || [],
  };
  const remoteIndex = remote[INDEX] || { profiles: [], deleted: [] };
  const mergedList = mergeProfileList(localIndex, remoteIndex, meta.current);
  applyProfileList(mergedList.profiles, mergedList.deleted);

  const now = Date.now();
  const outFiles = {};
  let currentChanged = false;
  for (const p of mergedList.profiles) {
    const fname = `profile-${p.id}.json`;
    const base = JSON.parse(localStorage.getItem(BASE(p.id)) || "{}");
    const all = readProfileData(p.id);
    // resume positions of downloaded files are keyed by this device's file paths → not synced
    const deviceOnly = {}, local = {};
    for (const [k, v] of Object.entries(all)) (DEVICE_ONLY.some((pre) => k.startsWith(pre)) ? deviceOnly : local)[k] = v;
    const remoteData = Object.fromEntries(
      Object.entries(remote[fname]?.data || {}).filter(([k]) => !DEVICE_ONLY.some((pre) => k.startsWith(pre))),
    );
    const merged = mergeProfile(base, local, remoteData);
    if (!same(merged, local)) {
      if (writeProfileData(p.id, { ...merged, ...deviceOnly })) currentChanged = true;
    }
    if (!same(merged, remoteData) || !remote[fname]) {
      outFiles[fname] = {
        content: JSON.stringify({ version: 1, updatedAt: now, profile: { id: p.id, name: p.name, color: p.color }, data: merged }),
      };
    }
    localStorage.setItem(BASE(p.id), JSON.stringify(merged));
  }
  for (const id of mergedList.deleted) {
    if (remote[`profile-${id}.json`]) outFiles[`profile-${id}.json`] = null; // delete file
    localStorage.removeItem(BASE(id));
  }
  if (!same(mergedList, { profiles: remoteIndex.profiles || [], deleted: remoteIndex.deleted || [] }) || !remote[INDEX] || Object.keys(outFiles).length) {
    outFiles[INDEX] = {
      content: JSON.stringify({ app: "streambert", version: 1, updatedAt: now, ...mergedList }, null, 1),
    };
  }

  if (Object.keys(outFiles).length) {
    if (!state().gistId) {
      const files = Object.fromEntries(Object.entries(outFiles).filter(([, v]) => v));
      const { data } = await gh("/gists", { method: "POST", body: { description: DESC, public: false, files } });
      setState({ gistId: data.id });
    } else {
      await gh(`/gists/${state().gistId}`, { method: "PATCH", body: { files: outFiles } });
    }
  }
  if (currentChanged) window.dispatchEvent(new Event("streambert:sync-applied"));
}

/** Auto sync: on start, every 5 minutes while open, and when the app goes to the background. */
export function initCloudSync() {
  const auto = () => getStatus().connected && getStatus().auto && syncNow();
  setTimeout(auto, 5000);
  setInterval(auto, AUTO_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) auto();
  });
}
