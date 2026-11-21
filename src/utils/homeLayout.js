// ── Home Page Layout Utilities ────────────────────────────────────────────────
// Shared between SettingsPage (editing) and HomePage (reading).

import { storage } from "./storage";

export const HOME_ROWS = [
  { id: "continue", label: "Continue Watching" },
  ...(typeof window !== "undefined" && window.electron?.isMobile
    ? [{ id: "upcoming", label: "Coming up (new episodes)" }]
    : []),
  { id: "recommended", label: "Recommended for You" },
  ...(typeof window !== "undefined" && window.electron?.isMobile
    ? [{ id: "because", label: "Because you watched…" }]
    : []),
  { id: "people", label: "New from people you follow" },
  { id: "trendingMovies", label: "Trending Movies" },
  { id: "trendingTV", label: "Trending Series" },
  { id: "topRated", label: "Top Rated" },
];

/** your own lists, read straight from storage (libraryExtras keeps them) */
function customLists() {
  try {
    const l = JSON.parse(localStorage.getItem("streambert_customLists") || "{}") || {};
    return Object.values(l).filter((x) => x && x.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } catch {
    return [];
  }
}

/** every row Home can show: the built-in ones, your watchlist and each of your lists */
export function allHomeRows() {
  return [
    ...HOME_ROWS,
    { id: "watchlist", label: "📌 Your watchlist", pinnable: true },
    ...customLists().map((l) => ({ id: `list:${l.id}`, label: `📌 ${l.name}`, pinnable: true })),
  ];
}

const DEFAULT_ROW_ORDER = HOME_ROWS.map((r) => r.id);
const DEFAULT_ROW_VISIBLE = Object.fromEntries(
  HOME_ROWS.map((r) => [r.id, true]),
);

export function loadHomeLayout() {
  const savedOrder = storage.get("homeRowOrder");
  const savedVisible = storage.get("homeRowVisible");
  const rows = allHomeRows();
  const knownIds = new Set(rows.map((r) => r.id));
  // pinned rows (watchlist, your lists) are off until you turn them on
  const defaults = Object.fromEntries(rows.map((r) => [r.id, !r.pinnable]));
  const all = rows.map((r) => r.id);

  const order = savedOrder
    ? [
        ...savedOrder.filter((id) => knownIds.has(id)),
        ...all.filter((id) => !savedOrder.includes(id)),
      ]
    : all;

  const visible = { ...defaults, ...(savedVisible || {}) };

  return { order, visible };
}

export function saveHomeLayout(order, visible) {
  storage.set("homeRowOrder", order);
  storage.set("homeRowVisible", visible);
}

/** "carousel" (default) | "list" */
export function loadHomeViewMode() {
  return storage.get("homeViewMode") || "carousel";
}

export function saveHomeViewMode(mode) {
  storage.set("homeViewMode", mode);
}

export function loadStartPage() {
  return storage.get("startPage") || "home";
}
