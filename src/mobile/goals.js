// Watch-time goals: "finish this show by <date>", with a pace hint.
// A goal keeps a snapshot of how many episodes have aired per season (updated
// whenever the show page is opened), so the library can show it offline.
import { storage } from "../utils/storage";

const KEY = "watchGoals";
const DAY = 86400000;
const EVT = "streambert:goals";

export function getGoals() {
  const g = storage.get(KEY);
  return g && typeof g === "object" ? g : {};
}
function save(g) {
  storage.set(KEY, g);
  window.dispatchEvent(new Event(EVT));
}
export const onGoals = (f) => {
  window.addEventListener(EVT, f);
  return () => window.removeEventListener(EVT, f);
};
export const getGoal = (id) => getGoals()[String(id)] || null;

/** [[season, airedEpisodes], ...] from TMDB show details (specials left out) */
export function airedPlan(d) {
  if (!d?.seasons?.length) return null;
  const last = d.last_episode_to_air;
  const ended = /ended|canceled/i.test(d.status || "");
  const out = [];
  for (const s of d.seasons) {
    const n = Number(s.season_number);
    if (!n || !s.episode_count) continue;
    let c = 0;
    if (!last) c = ended ? s.episode_count : 0;
    else if (n < last.season_number) c = s.episode_count;
    else if (n === last.season_number) c = Math.min(s.episode_count, last.episode_number);
    if (c > 0) out.push([n, c]);
  }
  return out;
}
const avgRuntime = (d) => {
  const r = (d?.episode_run_time || []).filter((x) => x > 0);
  if (r.length) return Math.round(r.reduce((a, b) => a + b, 0) / r.length);
  return d?.last_episode_to_air?.runtime || null;
};

export function setGoal(d, by) {
  const g = getGoals();
  const plan = airedPlan(d) || g[String(d.id)]?.plan || [];
  g[String(d.id)] = {
    id: d.id,
    title: d.name || d.title || "",
    poster_path: d.poster_path || null,
    by, // "YYYY-MM-DD"
    plan,
    runtime: avgRuntime(d),
    createdAt: g[String(d.id)]?.createdAt || Date.now(),
  };
  save(g);
}
export function removeGoal(id) {
  const g = getGoals();
  delete g[String(id)];
  save(g);
}
/** keep the aired-episodes snapshot fresh (show page opened) */
export function refreshGoal(d) {
  const g = getGoals();
  const cur = g[String(d?.id)];
  const plan = airedPlan(d);
  if (!cur || !plan) return;
  if (JSON.stringify(plan) === JSON.stringify(cur.plan) && cur.poster_path === (d.poster_path || null)) return;
  g[String(d.id)] = { ...cur, plan, runtime: avgRuntime(d) || cur.runtime, poster_path: d.poster_path || cur.poster_path };
  save(g);
}

function watchedMap() {
  const w = storage.get("watched");
  return w && typeof w === "object" ? w : {};
}

/** where a show stands against a plan + deadline */
export function progressFor(id, plan, by, runtime) {
  const w = watchedMap();
  let total = 0, done = 0;
  for (const [s, n] of plan || []) {
    total += n;
    for (let e = 1; e <= n; e++) if (w[`tv_${id}_s${s}e${e}`]) done++;
  }
  const left = Math.max(0, total - done);
  // calendar days until the goal date (0 = today); today counts as a watching day
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const target = new Date(`${by}T12:00:00`).getTime();
  const daysLeft = Number.isFinite(target) ? Math.round((target - today.getTime()) / DAY) : -1;
  const watchDays = daysLeft + 1;
  let pace = null;
  if (left > 0 && watchDays > 0) {
    const perDay = left / watchDays;
    if (perDay >= 1) pace = { perDay: Math.ceil(perDay) };
    else pace = { everyDays: Math.max(1, Math.floor(watchDays / left)) };
    if (runtime) pace.minutes = Math.ceil((left * runtime) / watchDays);
  }
  return { total, done, left, daysLeft, pace, finished: total > 0 && left === 0, overdue: left > 0 && daysLeft < 0 };
}
export const goalProgress = (goal) => progressFor(goal.id, goal.plan, goal.by, goal.runtime);

/** "2 episodes a day" / "1 episode every 3 days" */
export function paceText(p) {
  if (!p?.pace) return "";
  if (p.pace.perDay) return p.pace.perDay === 1 ? "1 episode a day" : `${p.pace.perDay} episodes a day`;
  return p.pace.everyDays === 1 ? "1 episode a day" : `1 episode every ${p.pace.everyDays} days`;
}
export const leftText = (n) => (n === 1 ? "1 episode left" : `${n} episodes left`);
export const daysText = (n) => (n < 0 ? "Goal date passed" : n === 0 ? "Due today" : n === 1 ? "1 day left" : `${n} days left`);

export const isoDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const addDays = (n) => isoDate(Date.now() + n * DAY);
