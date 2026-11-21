// Achievements: badges worked out from what already syncs (watched episodes,
// history, watch stats, ratings, lists), so they follow you to every device.
import { useEffect, useMemo, useState } from "react";
import { storage } from "../utils/storage";
import { getLists, getRatings, getStats, useLibraryExtras } from "./libraryExtras";
import "./achievements.css";

const H = 3600;
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function longestStreak(days) {
  const keys = Object.keys(days).filter((k) => days[k] > 0).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const t = new Date(k + "T12:00:00").getTime();
    run = prev != null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

/** everything the badges need, in one pass */
function facts() {
  const watched = storage.get("watched") || {};
  const history = storage.get("history") || [];
  const { days } = getStats();
  const wk = Object.keys(watched).filter((k) => watched[k]);
  const movies = wk.filter((k) => k.startsWith("movie_")).length;
  const episodes = wk.filter((k) => k.startsWith("tv_")).length;
  // most episodes of one season watched in a row (from episode 1)
  const bySeason = {};
  for (const k of wk) {
    const m = k.match(/^tv_(\d+)_s(\d+)e(\d+)$/);
    if (m) (bySeason[`${m[1]}_${m[2]}`] ||= new Set()).add(Number(m[3]));
  }
  let fullRun = 0;
  for (const set of Object.values(bySeason)) {
    let n = 0;
    while (set.has(n + 1)) n++;
    fullRun = Math.max(fullRun, n);
  }
  // episodes started per day, and late-night starts (history)
  const epsPerDay = {};
  let night = 0;
  for (const h of history) {
    if (!h?.watchedAt) continue;
    if (h.media_type === "tv") epsPerDay[dayOf(h.watchedAt)] = (epsPerDay[dayOf(h.watchedAt)] || 0) + 1;
    const hr = new Date(h.watchedAt).getHours();
    if (hr >= 0 && hr < 5) night++;
  }
  const totalSecs = Object.values(days).reduce((a, b) => a + b, 0);
  let parties = 0;
  try {
    parties = Number(localStorage.getItem("__sb_parties") || 0);
  } catch {}
  return {
    movies,
    episodes,
    titles: movies + new Set(wk.filter((k) => k.startsWith("tv_")).map((k) => k.split("_")[1])).size,
    fullRun,
    bestDayEps: Math.max(0, ...Object.values(epsPerDay)),
    bestDaySecs: Math.max(0, ...Object.values(days)),
    streak: longestStreak(days),
    hours: totalSecs / H,
    night,
    ratings: Object.keys(getRatings()).length,
    lists: Object.keys(getLists()).length,
    parties,
  };
}

// [id, emoji, name, how, value(f), goal]
const BADGES = [
  ["first", "🎬", "First watch", "Finish your first movie or episode", (f) => f.movies + f.episodes, 1],
  ["binge", "📺", "Binge watcher", "Start 5 episodes in one day", (f) => f.bestDayEps, 5],
  ["marathon", "🏃", "Marathon", "Watch 4 hours in one day", (f) => f.bestDaySecs / H, 4],
  ["owl", "🦉", "Night owl", "Start something after midnight", (f) => f.night, 1],
  ["streak7", "🔥", "On fire", "Watch 7 days in a row", (f) => f.streak, 7],
  ["streak30", "⚡", "Unstoppable", "Watch 30 days in a row", (f) => f.streak, 30],
  ["season", "✅", "Season done", "Watch 10 episodes of a season in order", (f) => f.fullRun, 10],
  ["eps100", "🍿", "Couch potato", "Finish 100 episodes", (f) => f.episodes, 100],
  ["buff", "🎞️", "Film buff", "Finish 50 movies", (f) => f.movies, 50],
  ["cinephile", "🏛️", "Cinephile", "Finish 200 movies", (f) => f.movies, 200],
  ["hours100", "💯", "Centurion", "Watch 100 hours in total", (f) => f.hours, 100],
  ["explorer", "🧭", "Explorer", "Finish 25 different titles", (f) => f.titles, 25],
  ["critic", "⭐", "Critic", "Rate 25 titles", (f) => f.ratings, 25],
  ["curator", "📚", "Curator", "Make 3 lists", (f) => f.lists, 3],
  ["party", "🎉", "Party animal", "Join or host a watch party", (f) => f.parties, 1],
];

export function achievements() {
  const f = facts();
  return BADGES.map(([id, emoji, name, how, val, goal]) => {
    const v = Math.max(0, val(f) || 0);
    return { id, emoji, name, how, value: v, goal, done: v >= goal, pct: Math.min(1, v / goal) };
  });
}

/** Library section */
export function AchievementsSection() {
  const { version } = useLibraryExtras();
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = () => setN((x) => x + 1);
    window.addEventListener("streambert:achievements", h);
    return () => window.removeEventListener("streambert:achievements", h);
  }, []);
  const list = useMemo(() => achievements(), [version, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = list.filter((a) => a.done).length;
  return (
    <div className="library-section" id="sb-achievements">
      <div className="library-section-title sbx-title-row">
        <span>Achievements</span>
        <span className="sbx-muted sbac-count" data-no-i18n>{done} / {list.length}</span>
      </div>
      <div className="sbac-grid">
        {[...list].sort((a, b) => b.done - a.done || b.pct - a.pct).map((a) => (
          <div key={a.id} className={`sbac${a.done ? " done" : ""}`} title={a.how}>
            <div className="sbac-emoji" aria-hidden="true">{a.emoji}</div>
            <div className="sbac-name">{a.name}</div>
            <div className="sbac-how">{a.how}</div>
            {!a.done && (
              <div className="sbac-bar" aria-label={`${Math.floor(a.value)} of ${a.goal}`}>
                <span style={{ transform: `scaleX(${a.pct})` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Achievement unlocked" pop-up (mounted once) */
export function AchievementToaster() {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    let queue = [];
    let timer = null;
    const next = () => {
      const a = queue.shift();
      setShown(a || null);
      if (a) timer = setTimeout(next, 4200);
      else timer = null;
    };
    const check = () => {
      const seen = new Set(storage.get("achvSeen") || []);
      const first = !localStorage.getItem("__sb_achv_init");
      const fresh = achievements().filter((a) => a.done && !seen.has(a.id));
      if (!fresh.length) return;
      storage.set("achvSeen", [...seen, ...fresh.map((a) => a.id)]);
      try {
        localStorage.setItem("__sb_achv_init", "1");
      } catch {}
      window.dispatchEvent(new Event("streambert:achievements"));
      if (first) return; // badges you already had when this came out: no pop-up flood
      queue.push(...fresh);
      if (!timer) next();
    };
    const t = setTimeout(check, 8000);
    const iv = setInterval(check, 60000);
    window.addEventListener("streambert:sync-applied", check);
    window.addEventListener("streambert:check-achievements", check);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
      clearTimeout(timer);
      window.removeEventListener("streambert:sync-applied", check);
      window.removeEventListener("streambert:check-achievements", check);
    };
  }, []);
  if (!shown) return null;
  return (
    <div className="sbac-toast" key={shown.id} role="status">
      <span className="sbac-toast-emoji" aria-hidden="true">{shown.emoji}</span>
      <div>
        <div className="sbac-toast-kicker">Achievement unlocked</div>
        <div className="sbac-toast-name">{shown.name}</div>
      </div>
    </div>
  );
}
