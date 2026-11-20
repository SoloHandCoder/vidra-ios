// Shareable "My year in Vidra" card (1080×1920 image, drawn on a canvas).
import { t } from "./i18n.js";

const W = 1080, H = 1920;
const loadImg = (src) =>
  new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 6000);
  });

function fmtHours(secs) {
  const h = secs / 3600;
  return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(secs / 60)} min`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * d = { year, totalSecs, titles, movies, shows, bestStreak, busiestMonth, top: {title, poster_path, secs}, genres: [[name, secs]] }
 * resolves a PNG data URL
 */
export async function makeStatsCard(d) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const font = (w, s) => `${w} ${s}px "DM Sans", "Segoe UI", Roboto, sans-serif`;
  const display = (s) => `${s}px "Bebas Neue", "Oswald", Impact, "DM Sans", sans-serif`;

  // background
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#3a0306");
  g.addColorStop(0.45, "#120707");
  g.addColorStop(1, "#0a0a0a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 140, 20, W * 0.85, 140, 700);
  glow.addColorStop(0, "rgba(229,9,20,0.55)");
  glow.addColorStop(1, "rgba(229,9,20,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#fff";
  ctx.font = font(700, 34);
  ctx.globalAlpha = 0.75;
  ctx.fillText(t(`Your ${d.year} in Vidra`).toUpperCase(), 80, 150);
  ctx.globalAlpha = 1;
  ctx.font = display(230);
  ctx.fillText(fmtHours(d.totalSecs), 72, 380);
  ctx.font = font(500, 40);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(t(`watched across ${d.titles} titles`), 80, 450);

  // top title
  let y = 540;
  const poster = await loadImg(d.top?.poster_path ? `https://image.tmdb.org/t/p/w500${d.top.poster_path}` : null);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  roundRect(ctx, 60, y, W - 120, 560, 36);
  ctx.fill();
  if (poster) {
    ctx.save();
    roundRect(ctx, 100, y + 40, 320, 480, 24);
    ctx.clip();
    ctx.drawImage(poster, 100, y + 40, 320, 480);
    ctx.restore();
  }
  const tx = poster ? 470 : 110;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = font(600, 32);
  ctx.fillText(t("Most watched"), tx, y + 120);
  ctx.fillStyle = "#fff";
  ctx.font = font(800, 54);
  wrap(ctx, d.top?.title || "—", tx, y + 190, W - tx - 100, 64, 4);
  ctx.fillStyle = "#ff4d57";
  ctx.font = font(700, 40);
  if (d.top) ctx.fillText(fmtHours(d.top.secs), tx, y + 480);

  // numbers
  y = 1170;
  const boxes = [
    [String(d.movies), t("Movies")],
    [String(d.shows), t("Series")],
    [String(d.bestStreak), t("longest streak (days)")],
    [d.busiestMonth || "–", t("busiest month")],
  ];
  boxes.forEach(([v, l], i) => {
    const bx = 60 + (i % 2) * ((W - 140) / 2 + 20), by = y + Math.floor(i / 2) * 230;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(ctx, bx, by, (W - 140) / 2, 200, 28);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = display(110);
    ctx.fillText(v, bx + 36, by + 120);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = font(600, 30);
    ctx.fillText(l, bx + 38, by + 170);
  });

  // genres
  y = 1670;
  if (d.genres?.length) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = font(700, 30);
    ctx.fillText(t("Top genres").toUpperCase(), 80, y);
    ctx.fillStyle = "#fff";
    ctx.font = font(700, 40);
    ctx.fillText(d.genres.slice(0, 3).map(([n]) => n).join("  ·  "), 80, y + 60);
  }
  // footer
  ctx.fillStyle = "#e50914";
  ctx.font = display(64);
  ctx.fillText("VIDRA", 80, H - 70);
  return c.toDataURL("image/png");
}

function wrap(ctx, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/);
  let line = "", n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lh);
      line = w;
      if (++n >= maxLines - 1) break;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + n * lh);
}

/** share (Android) or save / copy (desktop) */
export async function shareStatsCard(d) {
  const url = await makeStatsCard(d);
  const name = `streambert-${d.year}.png`;
  if (window.electron?.shareImage) return window.electron.shareImage({ dataUrl: url, name, text: t(`Your ${d.year} in Vidra`) });
  if (window.electron?.saveImage) return window.electron.saveImage({ dataUrl: url, name });
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  return { ok: true };
}
