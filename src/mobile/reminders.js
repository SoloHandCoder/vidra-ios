// Release-time reminders: a notification on the day a new episode of a show
// you saved or watch comes out, at the time you pick (TMDB only knows the air
// date, not the hour). Android schedules them natively (they fire even when
// the app is closed); the desktop app fires them while it's running and
// catches up on start.
import { loadUpcoming } from "./discovery.js";
import { t } from "./i18n.js";

const K_ON = "streambert_releaseReminders"; // default on
const K_HOUR = "streambert_reminderHour"; // 0-23, default 9
const K_SENT = "__sb_reminders_sent"; // desktop: keys already shown
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
export const remindersOn = () => read(K_ON, true) !== false;
export const setRemindersOn = (v) => localStorage.setItem(K_ON, JSON.stringify(!!v));
export const reminderHour = () => Number(read(K_HOUR, 9));
export const setReminderHour = (h) => localStorage.setItem(K_HOUR, JSON.stringify(Number(h)));

function at(dateStr, hour) {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** upcoming episodes as reminder items */
async function items(apiKey) {
  let saved = {}, history = [];
  try {
    saved = JSON.parse(localStorage.getItem("streambert_saved") || "{}");
    history = JSON.parse(localStorage.getItem("streambert_history") || "[]");
  } catch {}
  const up = await loadUpcoming(apiKey, saved, history);
  const hour = reminderHour();
  const limit = Date.now() + 21 * 86400000;
  return up
    .filter((u) => u.kind === "episode")
    .map((u) => ({
      key: `${u.id}_s${u.season}e${u.episode}`,
      showId: String(u.id),
      airDate: u.date,
      at: at(u.date, hour),
      title: u.title,
      text: t(`New episode today: S${String(u.season).padStart(2, "0")} E${String(u.episode).padStart(2, "0")}${u.episodeName && !/^Episode \d+$/i.test(u.episodeName) ? ` · ${u.episodeName}` : ""}`),
    }))
    .filter((r) => r.at <= limit);
}

let timers = [];
async function sync(apiKey) {
  if (!apiKey) return;
  const list = remindersOn() ? await items(apiKey).catch(() => []) : [];
  const el = window.electron;
  if (el?.scheduleReminders) {
    // Android: native, survives the app being closed
    await el.scheduleReminders(list.filter((r) => r.at > Date.now())).catch(() => {});
    return;
  }
  // desktop: timers while running, catch-up for today's
  timers.forEach(clearTimeout);
  timers = [];
  const sent = new Set(read(K_SENT, []));
  const fire = (r) => {
    if (sent.has(r.key)) return;
    sent.add(r.key);
    localStorage.setItem(K_SENT, JSON.stringify([...sent].slice(-200)));
    el?.showNotification?.({ title: r.title, body: r.text, url: `streambert://open/tv/${r.showId}` });
  };
  const now = Date.now();
  for (const r of list) {
    if (r.at <= now) {
      // missed earlier today (app was closed): show it now
      if (new Date(r.at).toDateString() === new Date().toDateString()) fire(r);
    } else if (r.at - now < 2 ** 31 - 1) timers.push(setTimeout(() => fire(r), r.at - now));
  }
}

/** getKey() returns the TMDB token */
export function initReminders(getKey) {
  const run = async () => sync(await getKey()).catch(() => {});
  setTimeout(run, 15000);
  setInterval(run, 6 * 3600 * 1000);
  window.addEventListener("streambert:reminders-changed", run);
}
