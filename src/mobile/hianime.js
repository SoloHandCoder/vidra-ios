// HiAnime (hianime.at) episode resolver, ported from the desktop main process
// (src/ipc/hianime.js). HTTP goes through the native layer (no CORS), the
// local player server is replaced by public/sb-player.html + the native media
// proxy (/__sbproxy) which adds the Referer header.
import { native, proxied } from "./native.js";

const BASE_URL = "https://hianime.at";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OBFUSCATION_KEY = new TextEncoder().encode("otaku-embed-v1");
const SERVER_NAME = "ZokoAnime";

/** referer per stream url, used by downloads of HiAnime streams */
export const hianimeReferers = new Map();

async function hianimeGet(url, { referer, accept } = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) headers.Referer = referer;
  const res = await native.http({ url, headers, timeout: 12000 });
  return { status: res.status, body: res.data };
}

async function hianimeCurl(url, opts) {
  const res = await hianimeGet(url, opts);
  if (/<title>\s*Just a moment/i.test(res.body)) {
    throw new Error("Blocked by Cloudflare (HiAnime)");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Request failed: HTTP ${res.status} from ${url}`);
  }
  return res.body;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function unwrapApiHtml(body) {
  let text = body;
  try {
    const json = JSON.parse(body);
    const parts = [];
    const walk = (v) => {
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(json);
    if (parts.length) text = parts.join("\n");
  } catch {}
  return text.replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\/g, "");
}

function getAttr(tagText, name) {
  const m = tagText.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function deobfuscateBlob(blob) {
  const buf = b64ToBytes(blob);
  for (let i = 0; i < buf.length; i++) {
    buf[i] ^= OBFUSCATION_KEY[i % OBFUSCATION_KEY.length];
  }
  return new TextDecoder().decode(buf);
}

async function hianimeSearch(query) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  const html = await hianimeCurl(`${BASE_URL}/search?keyword=${q}`, {
    accept: "text/html",
  });
  const main = html.split('id="main-sidebar"')[0];
  const results = [];
  const re = /<h3 class="film-name">([\s\S]*?)<\/h3>/g;
  let m;
  while ((m = re.exec(main))) {
    const anchor = m[1].match(/<a\s+([^>]*)>/);
    if (!anchor) continue;
    const href = getAttr(anchor[1], "href");
    const title = getAttr(anchor[1], "title");
    if (!href || !title) continue;
    const id = href.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (!id) continue;
    const jname = getAttr(anchor[1], "data-jname");
    results.push({
      id,
      title: decodeEntities(title),
      jname: jname ? decodeEntities(jname) : null,
    });
  }
  return results;
}

async function hianimeEpisodes(showId) {
  const numericId = showId.slice(showId.lastIndexOf("-") + 1);
  if (!/^\d+$/.test(numericId)) throw new Error("Invalid show id");
  const body = await hianimeCurl(
    `${BASE_URL}/api/theme/episode/list/${numericId}`,
    { referer: BASE_URL + "/" },
  );
  const html = unwrapApiHtml(body);
  const episodes = [];
  for (const chunk of html.split("ep-item").slice(1)) {
    const number = getAttr(chunk, "data-number");
    const epId = getAttr(chunk, "data-id");
    if (!number || !epId || !/^\d+$/.test(epId)) continue;
    if (!chunk.includes(`/watch/${showId}?ep=`)) continue;
    episodes.push({ epId, number });
  }
  return episodes;
}

async function hianimeStream(epId, mode) {
  const body = await hianimeCurl(
    `${BASE_URL}/api/theme/episode/servers?episodeId=${epId}`,
    { referer: BASE_URL + "/" },
  );
  const html = unwrapApiHtml(body);
  let hash = null;
  for (const chunk of html.split("server-item").slice(1)) {
    if (
      getAttr(chunk, "data-type") === mode &&
      getAttr(chunk, "data-server-name") === SERVER_NAME
    ) {
      hash = getAttr(chunk, "data-hash");
      if (hash) break;
    }
  }
  if (!hash) throw new Error(`No ${SERVER_NAME} server for ${mode}`);

  const embedUrl = new TextDecoder().decode(b64ToBytes(hash)).trim();
  if (!/^https?:\/\//i.test(embedUrl)) throw new Error("Invalid embed url");
  const referer = embedUrl.replace(/^(https?:\/\/[^/]*).*$/, "$1/");
  const malMatch = embedUrl.match(/\/mal\/(\d+)\//);
  const malId = malMatch ? parseInt(malMatch[1], 10) : null;

  const embedHtml = await hianimeCurl(embedUrl);
  const blobMatch = embedHtml.match(/window\.__P="([^"]*)"/);
  if (!blobMatch) throw new Error("Embed config not found");

  const jsonText = deobfuscateBlob(blobMatch[1]);
  let masterUrl = null;
  let subtitle = null;
  try {
    const cfg = JSON.parse(jsonText);
    const findM3u8 = (v) => {
      if (typeof v === "string") return /\.m3u8/i.test(v) ? v : null;
      if (Array.isArray(v)) {
        for (const x of v) {
          const r = findM3u8(x);
          if (r) return r;
        }
      } else if (v && typeof v === "object") {
        if (typeof v.src === "string" && /\.m3u8/i.test(v.src)) return v.src;
        for (const x of Object.values(v)) {
          const r = findM3u8(x);
          if (r) return r;
        }
      }
      return null;
    };
    masterUrl = findM3u8(cfg);
    const subs = Array.isArray(cfg.subtitles) ? cfg.subtitles : [];
    const def = subs.find((s) => s && s.default) || null;
    subtitle = def?.src || null;
  } catch {
    const m = jsonText.match(/"src":"([^"]*\.m3u8[^"]*)"/);
    masterUrl = m ? m[1] : null;
    const sub = jsonText
      .split(/\},\s*\{/)
      .find((c) => /"default":true/.test(c) && /"src":"/.test(c));
    subtitle = sub ? (sub.match(/"src":"([^"]*)"/) || [])[1] || null : null;
  }
  if (!masterUrl) throw new Error("No m3u8 source in embed config");
  masterUrl = masterUrl.replace(/\\\//g, "/");
  if (subtitle) subtitle = subtitle.replace(/\\\//g, "/");
  return { masterUrl, referer, malId, subtitle, resolution: "auto" };
}

function sanitizeTitle(t) {
  return t
    .replace(/[''`´]/g, "")
    .replace(/[:!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function anilistSeasonTitle(baseTitle, seasonNumber) {
  const resolveS1 = seasonNumber <= 1;
  const query = `query($search:String){Media(search:$search,type:ANIME,sort:SEARCH_MATCH){title{english romaji}episodes relations{edges{relationType node{type format title{english romaji}episodes startDate{year}seasonYear}}}}}`;
  const fallback = {
    title: baseTitle,
    romaji: null,
    episodes: null,
    nextTitle: null,
    nextRomaji: null,
  };
  try {
    const res = await native.http({
      url: "https://graphql.anilist.co/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables: { search: baseTitle } }),
      timeout: 8000,
    });
    const media = JSON.parse(res.data)?.data?.Media;
    if (!media) return fallback;
    const s1Romaji = media?.title?.romaji || null;
    const s1Episodes = media?.episodes || null;
    const sequels = (media.relations?.edges || [])
      .filter(
        (e) =>
          e.relationType === "SEQUEL" &&
          e.node.type === "ANIME" &&
          (e.node.format === "TV" || e.node.format === "TV_SHORT"),
      )
      .sort((a, b) => {
        const ya = a.node.startDate?.year || a.node.seasonYear || 9999;
        const yb = b.node.startDate?.year || b.node.seasonYear || 9999;
        return ya - yb;
      });
    const getTitle = (n) => n.title?.english || n.title?.romaji || null;
    const getRomaji = (n) => n.title?.romaji || null;
    if (resolveS1) {
      const next = sequels[0]?.node ?? null;
      return {
        title: media.title?.english || baseTitle,
        romaji: s1Romaji,
        episodes: s1Episodes,
        nextTitle: next ? getTitle(next) : null,
        nextRomaji: next ? getRomaji(next) : null,
      };
    }
    const target = sequels[seasonNumber - 2];
    if (!target) return { ...fallback, romaji: s1Romaji };
    const nextNode = sequels[seasonNumber - 1]?.node ?? null;
    return {
      title: getTitle(target.node) || baseTitle,
      romaji: getRomaji(target.node) || s1Romaji,
      episodes: target.node.episodes || null,
      nextTitle: nextNode ? getTitle(nextNode) : null,
      nextRomaji: nextNode ? getRomaji(nextNode) : null,
    };
  } catch {
    return fallback;
  }
}

const SHOW_CACHE_TTL = 10 * 60 * 1000;
const _episodeCache = new Map();
async function cachedEpisodes(showId) {
  const hit = _episodeCache.get(showId);
  if (hit && Date.now() - hit.ts < SHOW_CACHE_TTL) return hit.episodes;
  const episodes = await hianimeEpisodes(showId);
  if (episodes.length) _episodeCache.set(showId, { ts: Date.now(), episodes });
  return episodes;
}

const SHOW_LOOKUP_TTL = 30 * 60 * 1000;
const _showCache = new Map();
async function findShow(candidates) {
  const seen = new Set();
  const unique = candidates.filter((c) => {
    const n = normalizeTitle(c);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const cacheKey = [...seen].join("|");
  const hit = _showCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < SHOW_LOOKUP_TTL) return hit.show;
  let fallback = null;
  let found = null;
  for (const candidate of unique) {
    let results;
    try {
      results = await hianimeSearch(candidate);
    } catch (e) {
      if (/Cloudflare/i.test(e.message)) throw e;
      continue;
    }
    if (!results.length) continue;
    const exact = results.find(
      (r) =>
        seen.has(normalizeTitle(r.title)) ||
        (r.jname && seen.has(normalizeTitle(r.jname))),
    );
    if (exact) {
      found = exact;
      break;
    }
    if (!fallback) fallback = results[0];
  }
  const show = found || fallback;
  if (show) _showCache.set(cacheKey, { ts: Date.now(), show });
  return show;
}

const asString = (v, max = 300) =>
  typeof v === "string" ? v.slice(0, max) : "";
const asPosInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? n : fallback;
};

const progressListeners = new Set();
export function onHiAnimeProgress(cb) {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}
const report = (stage) => progressListeners.forEach((cb) => cb(stage));

export async function resolveHiAnime(args = {}) {
  try {
    const title = asString(args.title);
    if (!title) return { ok: false, error: "Missing title" };
    const isMovie = args.isMovie === true;
    const season = asPosInt(args.seasonNumber, 1) || 1;
    const episodeNumber = asPosInt(args.episodeNumber, 1) || 1;
    const mode = args.translationType === "dub" ? "dub" : "sub";
    report("search");
    const anilistResult = isMovie
      ? { title, romaji: null, episodes: null, nextTitle: null, nextRomaji: null }
      : await anilistSeasonTitle(title, season);
    let searchTitle = anilistResult.title;
    let adjustedEpisodeNumber = episodeNumber;
    if (
      !isMovie &&
      anilistResult.episodes &&
      episodeNumber > anilistResult.episodes &&
      anilistResult.nextTitle
    ) {
      adjustedEpisodeNumber = episodeNumber - anilistResult.episodes;
      searchTitle = anilistResult.nextTitle;
    }
    const candidates = [
      ...new Set([
        searchTitle,
        sanitizeTitle(searchTitle),
        ...(anilistResult.romaji && searchTitle === anilistResult.title
          ? [anilistResult.romaji]
          : []),
        ...(anilistResult.nextRomaji && searchTitle === anilistResult.nextTitle
          ? [anilistResult.nextRomaji]
          : []),
        title,
        sanitizeTitle(title),
      ]),
    ].filter(Boolean);
    const show = await findShow(candidates);
    if (!show) return { ok: false, error: "No results for: " + searchTitle };
    report("episodes");
    const episodes = await cachedEpisodes(show.id);
    if (!episodes.length)
      return { ok: false, error: "No episodes found for: " + show.title };
    const wantedNumber = isMovie ? "1" : String(adjustedEpisodeNumber);
    const episode =
      episodes.find((e) => e.number === wantedNumber) ||
      episodes.find((e) => parseFloat(e.number) === Number(wantedNumber)) ||
      (isMovie ? episodes[0] : null);
    if (!episode) return { ok: false, error: "Episode " + wantedNumber + " not found" };
    report("stream");
    const stream = await hianimeStream(episode.epId, mode);
    hianimeReferers.set(stream.masterUrl, stream.referer);
    return {
      ok: true,
      url: stream.masterUrl,
      resolution: stream.resolution,
      sourceName: SERVER_NAME,
      isDirectMp4: false,
      referer: stream.referer,
      subtitle: stream.subtitle,
      malId: stream.malId,
      searchTitle,
      matchedTitle: show.title,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

/** Builds the in-app player page URL (desktop: local 127.0.0.1 player server). */
export async function setPlayerVideo(args = {}) {
  const url = asString(args.url, 4096);
  const referer = asString(args.referer, 2048) || BASE_URL + "/";
  const subtitle = asString(args.subtitle, 4096) || null;
  const start = asPosInt(args.startTime, 0);
  if (!/^https?:\/\//i.test(url)) throw new Error("Invalid url");
  hianimeReferers.set(url, referer);
  const p = new URLSearchParams();
  p.set("src", proxied(url, referer));
  if (subtitle && /^https?:\/\//i.test(subtitle)) p.set("sub", proxied(subtitle, referer));
  if (start) p.set("t", String(start));
  p.set("cast", "1");
  return { playerUrl: `${location.origin}/sb-player.html?${p.toString()}` };
}

export async function debugHiAnime() {
  return { error: "disabled in packaged builds" };
}
