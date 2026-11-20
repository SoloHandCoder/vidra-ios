// ── Mobile: Subtitles ─────────────────────────────────────────────────────────
// Browser-side port of desktop/src/ipc/subtitles.js for the Capacitor (Android)
// build. Same argument objects and return shapes as the Electron IPC handlers:
//   search-subtitles            -> searchSubtitles(args)
//   get-subtitle-url            -> getSubtitleUrl(args)
//   download-subtitles-for-file -> downloadSubtitlesForFile(args)
//   prune-subtitle-paths        -> pruneSubtitlePaths(args)
//   delete-subtitle-file        -> deleteSubtitleFile(args)
// plus extractSubtitleLang(url).
//
// All network I/O goes through native.http (no CORS, custom headers allowed).
// Subtitle bytes are always moved as base64 so non-UTF-8 subtitle files are
// written byte-for-byte, exactly like the desktop (which writes raw Buffers).

import { native } from "./native.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Max decompressed zip entry size (10mb) to prevent zip-bombs
const ZIP_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// Only these extensions are accepted as subtitle files.
const SUBTITLE_EXTS = new Set(["srt", "vtt", "ass", "ssa"]);

const TEMP_SUB_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Optional directory for temporary SubDL extractions returned by
// getSubtitleUrl(). When unset, getSubtitleUrl returns a data: URL instead of
// a file:// URL (there is no os.tmpdir() equivalent in the WebView).
let tempSubtitleDir = null;
export function setSubtitleTempDir(dir) {
  tempSubtitleDir = dir ? normalizePath(dir) : null;
}

// ── Small helpers (no Node, no Buffer) ────────────────────────────────────────

function base64ToBytes(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const utf8Decoder = new TextDecoder("utf-8");
const utf8 = (bytes) => utf8Decoder.decode(bytes);

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const basename = (p) =>
  String(p || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || "";

// Rough equivalent of path.resolve for absolute forward-slash paths.
function normalizePath(p) {
  let s = String(p || "").replace(/\\/g, "/");
  if (s.startsWith("file://")) s = decodeURI(s.slice(7));
  const lead = s.startsWith("/") ? "/" : "";
  const parts = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return lead + parts.join("/");
}

const dirname = (p) => {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : ".") : n.slice(0, i);
};

const joinPath = (dir, name) => `${dir.replace(/\/+$/, "")}/${name}`;

const isOk = (res) => res && res.status >= 200 && res.status < 300;

function isTimeoutError(e) {
  if (!e) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  return /time(d)?\s*out|timeout/i.test(String(e.message || e));
}

async function httpText(url, headers, timeout) {
  return native.http({ url, method: "GET", headers, responseType: "text", timeout });
}

async function httpBytes(url, headers, timeout) {
  const res = await native.http({
    url,
    method: "GET",
    headers,
    responseType: "base64",
    timeout,
  });
  return { res, bytes: isOk(res) ? base64ToBytes(res.data) : null };
}

// Inflate raw DEFLATE data via DecompressionStream, capped at `max` bytes.
async function inflateRaw(bytes, max) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {}
      throw new Error("ZIP entry exceeds maximum output size");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// ── ZIP subtitle extractor ────────────────────────────────────────────────────
// Returns { data: Uint8Array, name } for the first subtitle entry, or null.

async function decodeEntry(buf, method, dataOffset, compressedSize) {
  const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) {
    if (compressed.length > ZIP_MAX_OUTPUT_BYTES) return null;
    return compressed;
  }
  if (method === 8) {
    try {
      return await inflateRaw(compressed, ZIP_MAX_OUTPUT_BYTES);
    } catch {
      return null;
    }
  }
  return null;
}

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) return i;
  }
  return -1;
}

async function extractFirstSubtitleFromZip(buf) {
  // 1) Central directory (handles entries using data descriptors).
  const eocd = findEOCD(buf);
  if (eocd >= 0) {
    const count = u16(buf, eocd + 10);
    let p = u32(buf, eocd + 16);
    for (let n = 0; n < count && p + 46 <= buf.length; n++) {
      if (u32(buf, p) !== 0x02014b50) break;
      const method = u16(buf, p + 10);
      const compressedSize = u32(buf, p + 20);
      const nameLen = u16(buf, p + 28);
      const extraLen = u16(buf, p + 30);
      const commentLen = u16(buf, p + 32);
      const lho = u32(buf, p + 42);
      const fileName = basename(utf8(buf.subarray(p + 46, p + 46 + nameLen)));
      p += 46 + nameLen + extraLen + commentLen;

      const ext = fileName.toLowerCase().split(".").pop();
      if (!SUBTITLE_EXTS.has(ext)) continue;
      if (lho + 30 > buf.length || u32(buf, lho) !== 0x04034b50) continue;
      const dataOffset = lho + 30 + u16(buf, lho + 26) + u16(buf, lho + 28);
      const data = await decodeEntry(buf, method, dataOffset, compressedSize);
      if (data) return { data, name: fileName };
    }
    return null;
  }

  // 2) Fallback: scan local file headers (same as desktop implementation).
  let offset = 0;
  while (offset < buf.length - 30) {
    if (u32(buf, offset) === 0x04034b50) {
      const method = u16(buf, offset + 8);
      const compressedSize = u32(buf, offset + 18);
      const nameLen = u16(buf, offset + 26);
      const extraLen = u16(buf, offset + 28);
      const fileName = basename(
        utf8(buf.subarray(offset + 30, offset + 30 + nameLen)),
      );
      const dataOffset = offset + 30 + nameLen + extraLen;
      const ext = fileName.toLowerCase().split(".").pop();
      if (SUBTITLE_EXTS.has(ext)) {
        const data = await decodeEntry(buf, method, dataOffset, compressedSize);
        if (data) return { data, name: fileName };
      }
      offset = dataOffset + compressedSize;
    } else {
      offset++;
    }
  }
  return null;
}

async function fetchSubDLZip(fileId) {
  const parts = String(fileId).split("_");
  const subdlPath = decodeURIComponent(parts.slice(2).join("_"));
  const { res, bytes } = await httpBytes(
    `https://dl.subdl.com${subdlPath}`,
    { "User-Agent": "Streambert" },
    30000,
  );
  if (!bytes) return { res, extracted: null };
  return { res, extracted: await extractFirstSubtitleFromZip(bytes) };
}

// ── Subtitle language extractor (from URL) ────────────────────────────────────

export function extractSubtitleLang(url) {
  try {
    const u = new URL(url);
    for (const param of ["lang", "language", "locale", "sub", "l"]) {
      const v = u.searchParams.get(param);
      if (v && v.length >= 2 && v.length <= 20) return v.toLowerCase();
    }
    const pathname = u.pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || "";
    const fileMatch = filename.match(/[._-]([a-z]{2,3})[._-]?(vtt|srt|ass)?$/i);
    if (fileMatch) return fileMatch[1].toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    for (const seg of segments.slice(0, -1)) {
      if (/^[a-z]{2,3}(-[A-Z]{2})?$/.test(seg)) return seg.toLowerCase();
    }
  } catch {}
  return "unknown";
}

// ── Subtitle search ───────────────────────────────────────────────────────────

export async function searchSubtitles({
  tmdbId,
  mediaType,
  season,
  episode,
  languages,
  subdlApiKey,
  wyzieApiKey,
} = {}) {
  function toSubDLLang(lang) {
    if (!lang) return "";
    return lang.split("-")[0].toUpperCase();
  }

  async function searchSubDL() {
    try {
      const params = new URLSearchParams({
        api_key: subdlApiKey,
        tmdb_id: String(tmdbId),
        type: mediaType === "tv" ? "tv" : "movie",
        subs_per_page: "30",
      });
      if (mediaType === "tv" && season != null)
        params.set("season_number", String(season));
      if (mediaType === "tv" && episode != null)
        params.set("episode_number", String(episode));
      if (languages) params.set("languages", toSubDLLang(languages));

      const res = await httpText(
        `https://api.subdl.com/api/v1/subtitles?${params}`,
        { "User-Agent": "Streambert" },
        12000,
      );
      if (!isOk(res)) {
        const errText = res?.data || "";
        return {
          ok: false,
          error: `SubDL error ${res?.status}: ${errText}`,
        };
      }
      const data = JSON.parse(res.data);
      if (!data.status) return { ok: false, error: "SubDL returned no results" };
      const results = (data.subtitles || []).map((s) => ({
        file_id: `subdl_${s.sd_id}_${encodeURIComponent(s.url)}`,
        file_name: s.name || s.release_name || "",
        language: (s.lang || "").toLowerCase(),
        release: s.release_name || s.name || "",
        uploader: s.author || "SubDL",
        download_count: s.downloads || 0,
        hearing_impaired: !!s.hi,
        ai_translated: false,
        machine_translated: false,
        ratings: 0,
        fps: null,
        from_trusted: false,
        via_subdl: true,
      }));
      if (results.length === 0) return { ok: false, error: "SubDL: no results" };
      return { ok: true, results, via_subdl: true };
    } catch (e) {
      const msg = isTimeoutError(e)
        ? "SubDL timed out, server may be temporarily unavailable"
        : e?.message || String(e);
      return { ok: false, error: msg };
    }
  }

  async function searchWyzie() {
    try {
      const params = new URLSearchParams({ id: String(tmdbId), format: "srt" });
      if (languages) params.set("language", languages);
      if (mediaType === "tv" && season != null) params.set("season", String(season));
      if (mediaType === "tv" && episode != null)
        params.set("episode", String(episode));

      if (wyzieApiKey) params.set("key", wyzieApiKey);

      const baseUrl = wyzieApiKey
        ? "https://sub.wyzie.io/search"
        : "https://subs.wyzie.ru/search";

      const res = await httpText(`${baseUrl}?${params}`, {}, 12000);
      if (!isOk(res)) {
        if (res?.status === 401 || res?.status === 403) {
          return {
            ok: false,
            error: `Wyzie API key invalid or expired (${res.status})`,
            wyzie_auth_error: true,
          };
        }
        return { ok: false, error: `Wyzie error ${res?.status}` };
      }
      const data = JSON.parse(res.data);
      const results = (Array.isArray(data) ? data : [])
        .filter((r) => r.url)
        .map((r, i) => {
          const rawUrl = r.url || "";
          const fullUrl = rawUrl.startsWith("http")
            ? rawUrl
            : `https://subs.wyzie.ru${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
          const displayName =
            r.display_name ||
            r.name ||
            r.release_name ||
            r.title ||
            r.SubFileName ||
            r.fileName ||
            "";
          const lang = (r.language || "").toUpperCase();
          const hiTag = r.isHearingImpaired ? " [HI]" : "";
          const aiTag = r.isAiTranslated ? " [AI]" : "";
          const src = r.source ? ` · ${r.source}` : "";
          const fallback = `${lang} subtitle${hiTag}${aiTag}${src} #${i + 1}`;
          return {
            file_id: `wyzie_${i}_${encodeURIComponent(fullUrl)}`,
            direct_url: fullUrl,
            file_name: displayName || fallback,
            language: r.language || "",
            release: displayName || fallback,
            uploader: "Wyzie",
            download_count: 0,
            hearing_impaired: !!r.isHearingImpaired,
            ai_translated: !!r.isAiTranslated,
            machine_translated: false,
            ratings: 0,
            fps: null,
            from_trusted: false,
            via_wyzie: true,
            original_source: r.source || "",
          };
        });
      if (results.length === 0) return { ok: false, error: "Wyzie: no results" };
      return { ok: true, results, via_wyzie: true };
    } catch (e) {
      const msg = isTimeoutError(e)
        ? "Subtitle service timed out, it may be temporarily down. Try adding a free SubDL API key in Settings for reliable results."
        : e?.message || String(e);
      return { ok: false, error: msg };
    }
  }

  const errors = [];
  if (subdlApiKey) {
    const r = await searchSubDL();
    if (r.ok) return r;
    errors.push(r.error);
  }
  const r = await searchWyzie();
  if (r.ok) return r;
  errors.push(r.error);
  const allTimedOut = errors.every((e) => e && e.includes("timed out"));
  return {
    ok: false,
    error: allTimedOut
      ? "Subtitle service timed out, it may be temporarily down. Add a free SubDL API key in Settings for reliable results."
      : errors.length > 0
        ? errors.join(" · ")
        : "No subtitles found. Try a different language or add a SubDL API key in Settings.",
  };
}

// ── Get subtitle download URL ─────────────────────────────────────────────────

const MIME_BY_EXT = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
  ssa: "text/x-ssa",
};

export async function getSubtitleUrl({ fileId } = {}) {
  try {
    if (String(fileId).startsWith("subdl_")) {
      const { res, extracted } = await fetchSubDLZip(fileId);
      if (!isOk(res)) return { ok: false, error: `SubDL download error ${res?.status}` };
      if (!extracted) return { ok: false, error: "No subtitle file found in SubDL ZIP" };

      const safeName = basename(extracted.name);
      const b64 = bytesToBase64(extracted.data);
      let url;
      if (tempSubtitleDir) {
        const tmpPath = joinPath(
          tempSubtitleDir,
          `streambert_sub_${Date.now()}_${safeName}`,
        );
        await native.writeFile({ path: tmpPath, data: b64, encoding: "base64" });
        // Schedule automatic cleanup so temp subtitles don't accumulate
        setTimeout(() => {
          native.deleteFile({ path: tmpPath }).catch(() => {});
        }, TEMP_SUB_TTL_MS);
        url = `file://${tmpPath}`;
      } else {
        const ext = safeName.toLowerCase().split(".").pop();
        url = `data:${MIME_BY_EXT[ext] || "text/plain"};base64,${b64}`;
      }

      return {
        ok: true,
        url,
        file_name: extracted.name,
        remaining: null,
        reset_time: null,
        via_subdl: true,
      };
    }

    if (String(fileId).startsWith("wyzie_")) {
      const url = decodeURIComponent(String(fileId).split("_").slice(2).join("_"));
      return {
        ok: true,
        url,
        file_name: "",
        remaining: null,
        reset_time: null,
        via_wyzie: true,
      };
    }

    return { ok: false, error: "Unknown subtitle source" };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ── Download subtitles for an already-completed file ──────────────────────────

export async function downloadSubtitlesForFile({ filePath, selectedSubs } = {}) {
  try {
    const resolvedFilePath = normalizePath(filePath);

    // The target must exist.
    let exists = false;
    try {
      exists = (await native.fileExists({ path: resolvedFilePath }))?.exists;
    } catch {}
    if (!exists) return { ok: false, error: "Target file does not exist" };

    // The file must be a known registry filePath, or sit inside a known
    // download directory (same guard as desktop).
    const allDownloads = (await native.getDownloads()) || [];
    const resolvedDir = dirname(resolvedFilePath);
    const isKnownFile = allDownloads.some(
      (d) => d.filePath && normalizePath(d.filePath) === resolvedFilePath,
    );
    const isInKnownDownloadDir = allDownloads.some((d) => {
      if (!d.downloadPath) return false;
      const dp = normalizePath(d.downloadPath);
      return resolvedDir === dp || resolvedDir.startsWith(dp + "/");
    });
    if (!isKnownFile && !isInKnownDownloadDir) {
      return { ok: false, error: "File is not in a known download directory" };
    }

    const dir = resolvedDir;
    const fileBase = basename(resolvedFilePath);
    // HLS downloads live as <folder>/index.m3u8 — name subs after the folder.
    const baseName =
      /^index\.m3u8$/i.test(fileBase) && dir !== "/" && dir !== "."
        ? basename(dir)
        : fileBase.includes(".")
          ? fileBase.slice(0, fileBase.lastIndexOf("."))
          : fileBase;
    const results = [];
    const langCounter = {};

    for (const sub of selectedSubs || []) {
      try {
        const langCode = (sub.language || sub.lang || "unknown").replace(
          /[^a-z0-9_-]/gi,
          "",
        );
        let fileData, ext;

        if (String(sub.file_id).startsWith("subdl_")) {
          const { res, extracted } = await fetchSubDLZip(sub.file_id);
          if (!isOk(res) || !extracted) continue;
          fileData = extracted.data;
          ext = extracted.name.split(".").pop().toLowerCase();
          if (!SUBTITLE_EXTS.has(ext)) continue;
        } else {
          const url =
            sub.direct_url ||
            (String(sub.file_id).startsWith("wyzie_")
              ? decodeURIComponent(String(sub.file_id).split("_").slice(2).join("_"))
              : null);
          if (!url) continue;
          const { bytes } = await httpBytes(url, {}, 30000);
          if (!bytes) continue;
          fileData = bytes;
          const urlExt = url.split("?")[0].split(".").pop().toLowerCase();
          ext = SUBTITLE_EXTS.has(urlExt) ? urlExt : "srt";
        }

        const lIdx = langCounter[langCode] ?? 0;
        langCounter[langCode] = lIdx + 1;
        const suffix = lIdx > 0 ? `.${lIdx}` : "";
        const destPath = joinPath(dir, `${baseName}.${langCode}${suffix}.${ext}`);
        await native.writeFile({
          path: destPath,
          data: bytesToBase64(fileData),
          encoding: "base64",
        });
        results.push({
          lang: langCode,
          path: destPath,
          file_id: sub.file_id || null,
          release: sub.release || sub.file_name || null,
          source: sub.via_subdl ? "subdl" : "wyzie",
        });
      } catch (subErr) {
        console.error("Subtitle download error:", subErr);
      }
    }

    // Merge into download registry
    if (results.length > 0 && resolvedFilePath) {
      const downloads = (await native.getDownloads()) || [];
      const entry = downloads.find(
        (d) => d.filePath && normalizePath(d.filePath) === resolvedFilePath,
      );
      if (entry) {
        const existing = entry.subtitlePaths || [];
        const existingFileIds = new Set(existing.map((s) => s.file_id).filter(Boolean));
        await native.updateDownload({
          id: entry.id,
          patch: {
            subtitlePaths: [
              ...existing,
              ...results.filter((r) => !r.file_id || !existingFileIds.has(r.file_id)),
            ],
          },
        });
      }
    }

    return { ok: true, subtitlePaths: results };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ── Prune subtitle paths that no longer exist on disk ─────────────────────────
// Accepts { downloadId } (IPC shape) or a bare id (preload wrapper shape).

export async function pruneSubtitlePaths(args) {
  try {
    const downloadId =
      args && typeof args === "object" ? args.downloadId : args;
    const downloads = (await native.getDownloads()) || [];
    const entry = downloads.find((d) => d.id === downloadId);
    if (!entry) return { ok: true, subtitlePaths: [] };
    const before = entry.subtitlePaths || [];
    const checks = await Promise.all(
      before.map(async (sp) => {
        const p = typeof sp === "string" ? sp : sp?.path;
        if (!p) return false;
        try {
          return !!(await native.fileExists({ path: p }))?.exists;
        } catch {
          return false;
        }
      }),
    );
    const after = before.filter((_, i) => checks[i]);
    if (after.length !== before.length) {
      await native.updateDownload({ id: entry.id, patch: { subtitlePaths: after } });
    }
    return { ok: true, subtitlePaths: after };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), subtitlePaths: [] };
  }
}

// ── Delete a single subtitle file ─────────────────────────────────────────────

export async function deleteSubtitleFile({ downloadId, subtitlePath } = {}) {
  try {
    if (subtitlePath && (await native.fileExists({ path: subtitlePath }))?.exists)
      await native.deleteFile({ path: subtitlePath });
    if (downloadId) {
      const downloads = (await native.getDownloads()) || [];
      const entry = downloads.find((d) => d.id === downloadId);
      if (entry) {
        await native.updateDownload({
          id: entry.id,
          patch: {
            subtitlePaths: (entry.subtitlePaths || []).filter(
              (sp) => sp.path !== subtitlePath,
            ),
          },
        });
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
