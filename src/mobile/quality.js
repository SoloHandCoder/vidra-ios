// Download quality: the highest video height to download (0 = best available).
// Default in Settings → Downloads; can be changed per download.
const KEY = "streambert_downloadQuality";
export const QUALITIES = [
  [0, "Best"],
  [1080, "1080p"],
  [720, "720p"],
  [480, "480p"],
];
export function getDefaultQuality() {
  try {
    return Number(JSON.parse(localStorage.getItem(KEY) || "0")) || 0;
  } catch {
    return 0;
  }
}
export function setDefaultQuality(q) {
  localStorage.setItem(KEY, JSON.stringify(Number(q) || 0));
}
