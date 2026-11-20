import { askParentPin, guardKids } from "./kids.js";
// Profiles: separate history, saved list, progress and watched episodes per person.
// Settings (theme, sources, TMDB token, downloads) are shared by all profiles.
// The active profile's data lives in the normal storage keys; switching saves
// it into a per-profile snapshot, loads the other one and reloads the app.

const P = "streambert_";
const META = "__sb_profiles";
const DATA = (id) => `__sb_profile_data_${id}`;

/** keys that belong to a person (everything else is a shared setting) */
const PERSONAL_KEYS = [
  "saved",
  "savedOrder",
  "progress",
  "watched",
  "history",
  "searchHistory",
  "episodeReleaseCache",
  "sourceFailoverCache",
  "myRatings",
  "customLists",
  "watchStats",
  "followedPeople",
  "peopleNews",
];
const PERSONAL_PREFIXES = ["dlTime_", "dlDur_", "localPos_"];

export const COLORS = ["#e50914", "#2f80ed", "#27ae60", "#f2994a", "#9b51e0", "#eb5757", "#00b8a9", "#f2c94c"];

function isPersonal(fullKey) {
  if (!fullKey.startsWith(P)) return false;
  const k = fullKey.slice(P.length);
  return PERSONAL_KEYS.includes(k) || PERSONAL_PREFIXES.some((p) => k.startsWith(p));
}

export function getMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META) || "null");
    if (m?.list?.length) return m;
  } catch {}
  return { current: "default", askOnStart: true, list: [{ id: "default", name: "Me", color: COLORS[0] }] };
}

function setMeta(m) {
  localStorage.setItem(META, JSON.stringify(m));
}

export function currentProfile() {
  const m = getMeta();
  return m.list.find((p) => p.id === m.current) || m.list[0];
}

function snapshot() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isPersonal(k)) out[k] = localStorage.getItem(k);
  }
  return out;
}

function clearPersonal() {
  const del = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isPersonal(k)) del.push(k);
  }
  del.forEach((k) => localStorage.removeItem(k));
}

export function switchProfile(id, { reload = true } = {}) {
  const m = getMeta();
  if (!m.list.some((p) => p.id === id)) return false;
  if (m.current !== id) {
    localStorage.setItem(DATA(m.current), JSON.stringify(snapshot()));
    clearPersonal();
    try {
      const data = JSON.parse(localStorage.getItem(DATA(id)) || "{}");
      for (const [k, v] of Object.entries(data)) if (isPersonal(k)) localStorage.setItem(k, v);
    } catch {}
    m.current = id;
    setMeta(m);
    if (reload) location.reload();
  }
  sessionStorage.setItem("__sb_profile_picked", "1");
  return true;
}

export function createProfile(name, color, extra = {}) {
  const m = getMeta();
  if (!localStorage.getItem(META)) setMeta(m); // persist the implicit default first
  const id = "p" + Date.now().toString(36);
  m.list.push({
    id,
    name: String(name || "Profile").slice(0, 24),
    color: color || COLORS[m.list.length % COLORS.length],
    editedAt: Date.now(),
    ...(extra.kids ? { kids: true, ageLimit: Number(extra.ageLimit ?? 12) } : {}),
  });
  localStorage.setItem(DATA(id), "{}");
  setMeta(m);
  return id;
}

export function updateProfile(id, patch) {
  const m = getMeta();
  const p = m.list.find((x) => x.id === id);
  if (!p) return;
  if (patch.name != null) p.name = String(patch.name).slice(0, 24) || p.name;
  if (patch.color) p.color = patch.color;
  if (patch.kids !== undefined) {
    if (patch.kids) {
      p.kids = true;
      p.ageLimit = Number(patch.ageLimit ?? p.ageLimit ?? 12);
    } else {
      delete p.kids;
      delete p.ageLimit;
    }
  }
  p.editedAt = Date.now();
  setMeta(m);
}

export function deleteProfile(id) {
  const m = getMeta();
  if (id === m.current || m.list.length <= 1) return false;
  m.list = m.list.filter((p) => p.id !== id);
  m.deleted = [...new Set([...(m.deleted || []), id])];
  localStorage.removeItem(DATA(id));
  setMeta(m);
  return true;
}

// ── data access for cloud sync ───────────────────────────────────────────────

/** A profile's personal data as { key (without "streambert_"): value }. */
export function readProfileData(id) {
  const m = getMeta();
  const out = {};
  const put = (fullKey, raw) => {
    try {
      out[fullKey.slice(P.length)] = JSON.parse(raw);
    } catch {}
  };
  if (id === m.current) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isPersonal(k)) put(k, localStorage.getItem(k));
    }
  } else {
    try {
      const data = JSON.parse(localStorage.getItem(DATA(id)) || "{}");
      for (const [k, v] of Object.entries(data)) if (isPersonal(k)) put(k, v);
    } catch {}
  }
  return out;
}

/** Replaces a profile's personal data. Returns true when the active profile changed. */
export function writeProfileData(id, data) {
  const m = getMeta();
  const entries = Object.entries(data || {}).filter(([k]) => isPersonal(P + k));
  if (id === m.current) {
    clearPersonal();
    for (const [k, v] of entries) localStorage.setItem(P + k, JSON.stringify(v));
    return true;
  }
  const snap = {};
  for (const [k, v] of entries) snap[P + k] = JSON.stringify(v);
  localStorage.setItem(DATA(id), JSON.stringify(snap));
  return false;
}

/** Applies a merged profile list from the cloud (keeps the active profile). */
export function applyProfileList(profiles, deleted) {
  const m = getMeta();
  const keep = new Map(profiles.map((p) => [p.id, p]));
  if (!keep.has(m.current)) keep.set(m.current, m.list.find((p) => p.id === m.current));
  for (const p of m.list) if (!keep.has(p.id) && !(deleted || []).includes(p.id)) keep.set(p.id, p);
  for (const id of deleted || []) if (id !== m.current) localStorage.removeItem(DATA(id));
  m.list = [...keep.values()].filter(Boolean);
  m.deleted = [...new Set([...(m.deleted || []), ...(deleted || [])])];
  setMeta(m);
}

export function setAskOnStart(v) {
  const m = getMeta();
  m.askOnStart = !!v;
  setMeta(m);
}

// ── "Who's watching?" picker ─────────────────────────────────────────────────

export function avatarHtml(p, size = 84) {
  const initial = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span class="sb-avatar" style="width:${size}px;height:${size}px;background:${p.color};font-size:${Math.round(size * 0.46)}px">${initial}</span>`;
}

export function showPicker({ onManage } = {}) {
  return new Promise((resolve) => {
    const m = getMeta();
    const el = document.createElement("div");
    el.className = "sb-profiles";
    el.innerHTML =
      '<div class="sb-profiles__title">Who\'s watching?</div><div class="sb-profiles__grid"></div>' +
      '<button class="sb-profiles__manage" type="button">Manage profiles</button>';
    const grid = el.querySelector(".sb-profiles__grid");
    m.list.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sb-profiles__item" + (p.id === m.current ? " sb-profiles__item--current" : "");
      b.innerHTML = avatarHtml(p) + `<span class="sb-profiles__name"></span>` + (p.kids ? `<span class="sb-kids-badge">KIDS</span>` : "");
      b.querySelector(".sb-profiles__name").textContent = p.name;
      b.onclick = async () => {
        // leaving a kids profile needs the parent PIN
        const cur = m.list.find((x) => x.id === m.current);
        if (cur?.kids && p.id !== cur.id && !(await askParentPin("Leaving a kids profile needs the parent PIN."))) return;
        el.classList.add("sb-profiles--out");
        setTimeout(() => el.remove(), 220);
        switchProfile(p.id);
        resolve(p.id);
      };
      grid.appendChild(b);
    });
    el.querySelector(".sb-profiles__manage").onclick = async () => {
      if (!(await guardKids("Managing profiles needs the parent PIN."))) return;
      el.remove();
      onManage?.();
      resolve(null);
    };
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("sb-profiles--in"));
    setTimeout(() => el.querySelector(".sb-profiles__item--current")?.focus(), 50);
  });
}

/** On app start: ask who's watching when there's more than one profile. */
export function initProfiles() {
  const m = getMeta();
  if (m.list.length > 1 && m.askOnStart && !sessionStorage.getItem("__sb_profile_picked")) {
    showPicker({
      onManage: () => {
        sessionStorage.setItem("__sb_profile_picked", "1");
        const go = () => (window.__sbNav ? window.__sbNav.go("settings") : setTimeout(go, 200));
        go();
      },
    });
  }
}
