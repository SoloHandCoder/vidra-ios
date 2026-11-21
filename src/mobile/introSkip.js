// "Skip intro" for shows without AniSkip data: Vidra learns where a show's intro
// is from how you skip. When you jump forward over the same stretch near the
// start of two episodes, the next episodes offer a button to skip it.
const KEY = "streambert_learnedSkips";
const MAX_START = 420; // the jump has to start within the first 7 minutes
const MIN_LEN = 20, MAX_LEN = 200; // seconds
const NEAR = 12; // two skips "match" when both ends are within 12 s

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function save(all) {
  try {
    const ids = Object.keys(all);
    if (ids.length > 300) for (const id of ids.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, ids.length - 300)) delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** the confirmed skip for a show: { start, end, kind: "intro" | "recap" } or null */
export function learnedSkip(showId) {
  const s = load()[showId];
  if (!s?.confirmed) return null;
  return { start: s.confirmed.start, end: s.confirmed.end, kind: s.confirmed.start < 15 ? "recap" : "intro" };
}

/** the user jumped from `from` to `to` (seconds) in an episode of this show */
export function noteSkip(showId, episodeKey, from, to) {
  const len = to - from;
  if (!showId || !(from >= 0) || from > MAX_START || len < MIN_LEN || len > MAX_LEN) return null;
  const all = load();
  const s = all[showId] || { seen: [] };
  // one observation per episode (the latest one wins)
  s.seen = (s.seen || []).filter((x) => x.ep !== episodeKey).slice(-5);
  s.seen.push({ ep: episodeKey, start: Math.round(from), end: Math.round(to) });
  // two different episodes that agree → confirmed (averaged)
  const last = s.seen[s.seen.length - 1];
  const match = s.seen.slice(0, -1).reverse().find((x) => Math.abs(x.start - last.start) <= NEAR && Math.abs(x.end - last.end) <= NEAR);
  if (match) s.confirmed = { start: Math.round((match.start + last.start) / 2), end: Math.round((match.end + last.end) / 2) };
  s.at = Date.now();
  all[showId] = s;
  save(all);
  return learnedSkip(showId);
}

/** "That's not the intro": forget what was learned for this show */
export function forgetSkip(showId) {
  const all = load();
  delete all[showId];
  save(all);
}
