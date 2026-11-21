// Three-way merge for cloud sync (pure functions, no browser APIs).
//
//   base   = data as it was after the last successful sync
//   local  = data on this device now
//   remote = data in the cloud now
//
// Rules:
//  - map-like keys (saved, progress, watched, …) merge per entry, so changes to
//    different titles on two devices both survive; deletions carry over.
//  - history merges per watched entry (id + season + episode), newest
//    `watchedAt` wins, sorted newest first, capped at 100.
//  - anything else (savedOrder, searchHistory, resume times …) is one value:
//    whichever side changed wins; if both changed, this device wins (it is the
//    most recent change at the moment it syncs).

export const MAP_KEYS = new Set(["saved", "progress", "watched", "episodeReleaseCache", "sourceFailoverCache", "myRatings", "followedPeople"]);
export const HISTORY_LIMIT = 100;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** pick for one value; `undefined` means "absent / deleted" */
export function pick3(b, l, r) {
  if (same(l, r)) return l;
  if (same(l, b)) return r; // only remote changed
  if (same(r, b)) return l; // only local changed
  return l; // both changed → this device
}

export function mergeMap(b, l, r) {
  b = isObj(b) ? b : {};
  l = isObj(l) ? l : {};
  r = isObj(r) ? r : {};
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const v = pick3(b[k], l[k], r[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const histKey = (h) => `${h?.media_type}|${h?.id}|${h?.season ?? ""}|${h?.episode ?? ""}`;

export function mergeHistory(b, l, r) {
  const toMap = (a) => {
    const m = new Map();
    for (const h of Array.isArray(a) ? a : []) if (h && h.id != null) m.set(histKey(h), h);
    return m;
  };
  const B = toMap(b), L = toMap(l), R = toMap(r);
  const out = [];
  for (const k of new Set([...L.keys(), ...R.keys()])) {
    const lh = L.get(k), rh = R.get(k), inBase = B.has(k);
    if (lh && rh) out.push((rh.watchedAt || 0) > (lh.watchedAt || 0) ? rh : lh);
    else if (lh) { if (!inBase || !same(lh, B.get(k))) out.push(lh); } // new here (or re-watched); else deleted remotely
    else if (rh) { if (!inBase || !same(rh, B.get(k))) out.push(rh); } // new remotely; else deleted here
  }
  out.sort((a, c) => (c.watchedAt || 0) - (a.watchedAt || 0));
  return out.slice(0, HISTORY_LIMIT);
}

// custom lists: per list, the name merges as one value and the items per title
export function mergeLists(b, l, r) {
  b = isObj(b) ? b : {};
  l = isObj(l) ? l : {};
  r = isObj(r) ? r : {};
  const out = {};
  for (const id of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const bl = b[id], ll = l[id], rl = r[id];
    if (!ll || !rl) {
      const v = pick3(bl, ll, rl); // created or deleted on one side
      if (v) out[id] = v;
      continue;
    }
    const { items: bi, ...bm } = bl || {};
    const { items: li, ...lm } = ll;
    const { items: ri, ...rm } = rl;
    out[id] = { ...pick3(bl ? bm : undefined, lm, rm), items: mergeMap(bi, li, ri) };
  }
  return out;
}

// watch statistics are kept per device, so each device's entry merges as a value
export function mergeStats(b, l, r) {
  return { devices: mergeMap(b?.devices, l?.devices, r?.devices) };
}

/** merges one profile's data maps (key → parsed value). Returns the merged map. */
export function mergeProfile(base = {}, local = {}, remote = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    let v;
    if (k === "history") v = mergeHistory(base[k], local[k], remote[k]);
    else if (k === "lastPlayed") v = (remote[k]?.at || 0) > (local[k]?.at || 0) ? remote[k] : local[k] ?? remote[k];
    else if (k === "customLists") v = mergeLists(base[k], local[k], remote[k]);
    else if (k === "watchStats") v = mergeStats(base[k], local[k], remote[k]);
    else if (MAP_KEYS.has(k)) v = mergeMap(base[k], local[k], remote[k]);
    else v = pick3(base[k], local[k], remote[k]);
    if (v !== undefined && !(Array.isArray(v) && v.length === 0 && local[k] === undefined && remote[k] === undefined)) {
      out[k] = v;
    }
  }
  return out;
}

/** merges profile lists: union by id; profiles deleted on either side stay deleted (except the current one). */
export function mergeProfileList(localMeta, remoteMeta, currentId) {
  const deleted = new Set([...(localMeta?.deleted || []), ...(remoteMeta?.deleted || [])]);
  deleted.delete(currentId);
  const byId = new Map();
  for (const p of remoteMeta?.profiles || []) byId.set(p.id, p);
  for (const p of localMeta?.profiles || []) {
    const r = byId.get(p.id);
    // most recently edited name/color wins
    byId.set(p.id, r && (r.editedAt || 0) > (p.editedAt || 0) ? r : p);
  }
  const profiles = [...byId.values()].filter((p) => !deleted.has(p.id));
  return { profiles, deleted: [...deleted] };
}

export { same };
