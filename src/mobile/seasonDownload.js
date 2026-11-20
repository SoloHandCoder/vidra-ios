// "Download season": resolves every episode's stream one after another and
// queues the downloads (the native downloader runs 2 at a time).
//  - HiAnime source: resolved directly (no player needed)
//  - other sources: each episode's player is loaded hidden until it requests its stream

let running = null;

function banner() {
  let el = document.getElementById("sb-season-dl");
  if (!el) {
    el = document.createElement("div");
    el.id = "sb-season-dl";
    el.innerHTML =
      '<div class="sb-sdl__text"></div><div class="sb-sdl__bar"><div class="sb-sdl__fill"></div></div><button class="sb-sdl__x" aria-label="Stop">Stop</button>';
    el.querySelector(".sb-sdl__x").onclick = () => {
      if (running) running.cancelled = true;
    };
    document.body.appendChild(el);
  }
  return el;
}

function show(text, frac) {
  const el = banner();
  el.querySelector(".sb-sdl__text").textContent = text;
  el.querySelector(".sb-sdl__fill").style.width = `${Math.round((frac || 0) * 100)}%`;
  el.classList.add("sb-sdl--on");
}

function hide(delay = 0) {
  setTimeout(() => document.getElementById("sb-season-dl")?.classList.remove("sb-sdl--on"), delay);
}

/**
 * @param {object} o
 *   baseName      "Show (2020)"
 *   tmdbId, season, posterPath
 *   episodes      [{ episode_number, _tmdbSeason?, _tmdbAbsolute? }]
 *   skip          Set of episode numbers already downloaded / downloading
 *   async         true for the HiAnime source
 *   animeTitle, dubMode  (HiAnime)
 *   embedUrl(ep)  embed player URL for an episode (other sources)
 */
export async function downloadSeason(o) {
  const el = window.electron;
  if (!el?.runDownload) return;
  if (running) {
    show("A season download is already being prepared…", running.frac);
    return;
  }
  const todo = o.episodes.filter((ep) => !o.skip?.has(ep.episode_number));
  if (!todo.length) {
    show("All episodes of this season are already downloaded", 1);
    hide(2500);
    return;
  }
  const job = (running = { cancelled: false, frac: 0 });
  let ok = 0, failed = [];
  const s2 = String(o.season).padStart(2, "0");
  try {
    for (let i = 0; i < todo.length; i++) {
      if (job.cancelled) break;
      const ep = todo[i];
      const n = ep.episode_number;
      const e2 = String(n).padStart(2, "0");
      job.frac = i / todo.length;
      show(`${o.label ? o.label + " · " : ""}Season ${o.season}: getting episode ${n} (${i + 1}/${todo.length})…`, job.frac);
      let url = null;
      try {
        if (o.async) {
          const r = await el.resolveHiAnime({
            title: o.animeTitle,
            seasonNumber: o.season,
            episodeNumber: n,
            isMovie: false,
            translationType: o.dubMode || "sub",
          });
          url = r?.ok ? r.url : null;
        } else {
          const r = await el.captureStream(o.embedUrl(ep), 45000);
          url = r?.url || null;
        }
      } catch {
        url = null;
      }
      if (job.cancelled) break;
      if (!url) {
        failed.push(n);
        continue;
      }
      const res = await el.runDownload({
        token: "android-native",
        m3u8Url: url,
        name: `${o.baseName} S${s2} E${e2}`,
        downloadPath: "",
        mediaId: o.tmdbId,
        mediaType: "tv",
        season: o.season,
        episode: n,
        posterPath: o.posterPath || null,
        tmdbId: o.tmdbId,
        subtitles: [],
        quality: (await import("./quality.js")).getDefaultQuality(),
      });
      if (res?.ok) ok++;
      else failed.push(n);
    }
  } finally {
    running = null;
  }
  const parts = [];
  if (ok) parts.push(`${ok} episode${ok === 1 ? "" : "s"} added to Downloads`);
  if (failed.length) parts.push(`couldn't get E${failed.join(", E")}`);
  if (job.cancelled) parts.unshift("Stopped");
  show(parts.join(" · ") || "Nothing to download", 1);
  hide(4500);
}

export function isSeasonDownloadRunning() {
  return !!running;
}
