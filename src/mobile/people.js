// Following actors & directors: new titles they're in show up on Home and as a
// notification (checked about once a day). Per profile, synced.
//   streambert_followedPeople { "<personId>": { id, name, profile_path, known: [creditKeys], followedAt } }
//   streambert_peopleNews     [ { person: {id,name}, item, at } ]  newest first
import { useEffect, useState } from "react";
import { tmdbFetch } from "../utils/api";
import { t } from "./i18n.js";

const K_FOLLOW = "streambert_followedPeople";
const K_NEWS = "streambert_peopleNews";
const K_LAST = "__sb_people_checked";
const EVT = "streambert:people-changed";
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
  window.dispatchEvent(new Event(EVT));
};

export const getFollowed = () => read(K_FOLLOW, {});
export const isFollowing = (id) => !!getFollowed()[id];
export const getPeopleNews = () => read(K_NEWS, []);

const creditKey = (c) => `${c.media_type}_${c.id}`;
const relevant = (c) => (c.media_type === "movie" || c.media_type === "tv") && c.poster_path && !(c.genre_ids || []).includes(10767) && !(c.genre_ids || []).includes(10763); // no talk shows / news

/** follow / unfollow; `credits` = the person's combined credits (already loaded) */
export function toggleFollow(person, credits) {
  const f = getFollowed();
  if (f[person.id]) delete f[person.id];
  else {
    const all = [...(credits?.cast || []), ...(credits?.crew || [])].filter(relevant);
    f[person.id] = {
      id: person.id,
      name: person.name,
      profile_path: person.profile_path || null,
      known: [...new Set(all.map(creditKey))],
      followedAt: Date.now(),
    };
  }
  write(K_FOLLOW, f);
  return !!f[person.id];
}

/** checks followed people for new titles (at most once every 20 h unless forced) */
export async function checkPeople(apiKey, { force = false, notify = true } = {}) {
  if (!apiKey) return [];
  const last = Number(localStorage.getItem(K_LAST) || 0);
  if (!force && Date.now() - last < 20 * 3600 * 1000) return [];
  const f = getFollowed();
  const ids = Object.keys(f).slice(0, 40);
  if (!ids.length) return [];
  localStorage.setItem(K_LAST, String(Date.now()));
  const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const found = [];
  for (const id of ids) {
    let cr;
    try {
      cr = await tmdbFetch(`/person/${id}/combined_credits`, apiKey);
    } catch {
      continue;
    }
    const p = f[id];
    const known = new Set(p.known || []);
    const all = [...(cr?.cast || []), ...(cr?.crew || [])].filter(relevant);
    for (const c of all) {
      const k = creditKey(c);
      if (known.has(k)) continue;
      known.add(k);
      const date = c.release_date || c.first_air_date || "";
      if (date && date < cutoff) continue; // an old title TMDB just added: not news
      found.push({
        person: { id: p.id, name: p.name },
        item: { id: c.id, media_type: c.media_type, title: c.title || c.name, poster_path: c.poster_path, backdrop_path: c.backdrop_path || null, vote_average: c.vote_average ?? null, release_date: date },
        at: Date.now(),
      });
    }
    f[id] = { ...p, known: [...known] };
  }
  write(K_FOLLOW, f);
  if (found.length) {
    const seen = new Set();
    const news = [...found, ...getPeopleNews()].filter((n) => {
      const k = creditKey(n.item);
      return !seen.has(k) && seen.add(k);
    });
    write(K_NEWS, news.slice(0, 40));
    if (notify && window.electron?.showNotification) {
      const first = found[0];
      const more = found.length - 1;
      window.electron.showNotification({
        title: t(`New from ${first.person.name}`),
        body: more > 0 ? t(`${first.item.title} and ${more} more`) : first.item.title,
        url: `streambert://open/${first.item.media_type}/${first.item.id}`,
      });
    }
  }
  return found;
}

export function usePeople() {
  const [, setN] = useState(0);
  useEffect(() => {
    const h = () => setN((x) => x + 1);
    window.addEventListener(EVT, h);
    window.addEventListener("streambert:sync-applied", h);
    return () => {
      window.removeEventListener(EVT, h);
      window.removeEventListener("streambert:sync-applied", h);
    };
  }, []);
  return { followed: getFollowed(), news: getPeopleNews() };
}

/** starts the daily check (needs the TMDB token; `getKey` returns it) */
export function initPeople(getKey) {
  const run = async () => {
    const k = await getKey();
    if (k) checkPeople(k).catch(() => {});
  };
  setTimeout(run, 20000);
  setInterval(run, 3 * 3600 * 1000);
}
