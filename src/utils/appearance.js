// ── Accent colour presets & helpers ──────────────────────────────────────────
// Kept in a separate file so both App.jsx and SettingsPage.jsx can import
// without creating a circular dependency.

export const ACCENT_PRESETS = [
  {
    id: "red",
    label: "Red",
    color: "#e50914",
    color2: "#ff1a24",
    dim: "rgba(229,9,20,0.15)",
    glow: "0 0 30px rgba(229,9,20,0.3)",
  },
  {
    id: "blue",
    label: "Blue",
    color: "#2563eb",
    color2: "#3b82f6",
    dim: "rgba(37,99,235,0.15)",
    glow: "0 0 30px rgba(37,99,235,0.3)",
  },
  {
    id: "purple",
    label: "Purple",
    color: "#7c3aed",
    color2: "#8b5cf6",
    dim: "rgba(124,58,237,0.15)",
    glow: "0 0 30px rgba(124,58,237,0.3)",
  },
  {
    id: "green",
    label: "Green",
    color: "#059669",
    color2: "#10b981",
    dim: "rgba(5,150,105,0.15)",
    glow: "0 0 30px rgba(5,150,105,0.3)",
  },
  {
    id: "orange",
    label: "Orange",
    color: "#d97706",
    color2: "#f59e0b",
    dim: "rgba(217,119,6,0.15)",
    glow: "0 0 30px rgba(217,119,6,0.3)",
  },
  {
    id: "pink",
    label: "Pink",
    color: "#db2777",
    color2: "#ec4899",
    dim: "rgba(219,39,119,0.15)",
    glow: "0 0 30px rgba(219,39,119,0.3)",
  },
  ...[
    ["teal", "Teal", "#0d9488", "#14b8a6"],
    ["cyan", "Cyan", "#0891b2", "#06b6d4"],
    ["indigo", "Indigo", "#4f46e5", "#6366f1"],
    ["gold", "Gold", "#ca8a04", "#eab308"],
    ["lime", "Lime", "#65a30d", "#84cc16"],
    ["coral", "Coral", "#e2553d", "#f97360"],
  ].map(([id, label, color, color2]) => accentFrom(id, label, color, color2)),
];

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function accentFrom(id, label, color, color2) {
  const [r, g, b] = hexRgb(color);
  return { id, label, color, color2, dim: `rgba(${r},${g},${b},0.15)`, glow: `0 0 30px rgba(${r},${g},${b},0.3)` };
}
const lighten = (hex, t = 0.18) => {
  const c = hexRgb(hex);
  return "#" + c.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0")).join("");
};

/** a preset, or your own colour (the id is then the colour itself, "#rrggbb") */
export function accentPreset(id) {
  if (hexRgb(id) && String(id).startsWith("#")) return accentFrom(id, "Custom", id, lighten(id));
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
}
export const accentHexOf = (id) => accentPreset(id).color;
export const accentLabel = (id) => accentPreset(id).label;

export function applyAccentColor(presetId) {
  const preset = accentPreset(presetId);
  const root = document.documentElement;
  root.style.setProperty("--red", preset.color);
  root.style.setProperty("--red2", preset.color2);
  root.style.setProperty("--red-dim", preset.dim);
  root.style.setProperty("--red-glow", preset.glow);
}

// ── Theme presets ─────────────────────────────────────────────────────────────

/**
 * Each theme defines the background/surface/text CSS variables.
 * The accent colour (--red / --red2 / ...) is applied via applyAccentColor.
 */
export const THEME_PRESETS = [
  {
    id: "dark",
    label: "Dark",
    description: "Default dark theme",
    vars: {
      "--bg": "#0a0a0a",
      "--surface": "#111111",
      "--surface2": "#1a1a1a",
      "--surface3": "#222222",
      "--border": "#2a2a2a",
      "--text": "#f0f0f0",
      "--text2": "#c0c0c0",
      "--text3": "#909090",
    },
  },
  {
    id: "amoled",
    label: "AMOLED",
    description: "Very black :) (for OLED displays)",
    vars: {
      "--bg": "#000000",
      "--surface": "#080808",
      "--surface2": "#111111",
      "--surface3": "#181818",
      "--border": "#1f1f1f",
      "--text": "#ffffff",
      "--text2": "#cccccc",
      "--text3": "#888888",
    },
  },
  {
    id: "mocha",
    label: "Mocha",
    description: "Warm dark brown tones",
    vars: {
      "--bg": "#0e0b09",
      "--surface": "#1a1410",
      "--surface2": "#231c16",
      "--surface3": "#2e251d",
      "--border": "#3a2e24",
      "--text": "#f0e8df",
      "--text2": "#c4b09a",
      "--text3": "#8a7060",
    },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue-grey tones",
    vars: {
      "--bg": "#0d1117",
      "--surface": "#161b22",
      "--surface2": "#1f2937",
      "--surface3": "#273344",
      "--border": "#30363d",
      "--text": "#e6edf3",
      "--text2": "#8b949e",
      "--text3": "#6e7681",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy blue",
    vars: {
      "--bg": "#070b18",
      "--surface": "#0d1326",
      "--surface2": "#141c36",
      "--surface3": "#1c2646",
      "--border": "#263258",
      "--text": "#eef1fb",
      "--text2": "#b4bddb",
      "--text3": "#7f8ab0",
    },
  },
  {
    id: "nord",
    label: "Nord",
    description: "Calm arctic blue-grey",
    vars: {
      "--bg": "#242933",
      "--surface": "#2e3440",
      "--surface2": "#3b4252",
      "--surface3": "#434c5e",
      "--border": "#4c566a",
      "--text": "#eceff4",
      "--text2": "#d8dee9",
      "--text3": "#9aa5b8",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    description: "Dark purple-grey",
    vars: {
      "--bg": "#1e1f29",
      "--surface": "#282a36",
      "--surface2": "#313442",
      "--surface3": "#3b3e50",
      "--border": "#44475a",
      "--text": "#f8f8f2",
      "--text2": "#cfd0dc",
      "--text3": "#8f93ad",
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Dark green tones",
    vars: {
      "--bg": "#08110c",
      "--surface": "#0e1a13",
      "--surface2": "#15251b",
      "--surface3": "#1d3125",
      "--border": "#274032",
      "--text": "#e9f4ec",
      "--text2": "#b3cdbb",
      "--text3": "#7d9a87",
    },
  },
  {
    id: "rose",
    label: "Rosé",
    description: "Dark with a warm pink tint",
    vars: {
      "--bg": "#140b0f",
      "--surface": "#1e1117",
      "--surface2": "#2a1820",
      "--surface3": "#36202a",
      "--border": "#452a36",
      "--text": "#fbeef2",
      "--text2": "#d9b8c4",
      "--text3": "#a07f8c",
    },
  },
  {
    id: "light",
    label: "Light",
    description: "Very white (basic light theme)",
    vars: {
      "--bg": "#ebebed",
      "--surface": "#f8f8fa",
      "--surface2": "#eeeef0",
      "--surface3": "#e2e2e5",
      "--border": "#c8c8cc",
      "--text": "#111113",
      "--text2": "#3a3a40",
      "--text3": "#6b6b74",
    },
  },
  {
    id: "sepia",
    label: "Sepia",
    description: "Warm paper tones (light)",
    vars: {
      "--bg": "#efe6d5",
      "--surface": "#f8f1e3",
      "--surface2": "#efe5d2",
      "--surface3": "#e4d8c1",
      "--border": "#cdbfa5",
      "--text": "#2b2118",
      "--text2": "#54463a",
      "--text3": "#84735f",
    },
  },
  {
    id: "system",
    label: "Auto",
    description: "Follows your device: Light when it's in light mode, Dark otherwise",
    swatch: "linear-gradient(135deg, #f8f8fa 50%, #111111 50%)",
    vars: null,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Your own colours",
    vars: null,
  },
];

/** Default custom theme vars (used when user first opens the custom editor). */
export const DEFAULT_CUSTOM_VARS = {
  "--bg": "#0a0a0a",
  "--surface": "#111111",
  "--surface2": "#1a1a1a",
  "--surface3": "#222222",
  "--border": "#2a2a2a",
  "--text": "#f0f0f0",
  "--text2": "#c0c0c0",
  "--text3": "#909090",
};

/**
 * Apply a theme by id.
 * @param {string} themeId  - id from THEME_PRESETS
 * @param {object|null} customVars - only used when themeId === "custom"
 */
let systemMq = null;
export function applyTheme(themeId, customVars = null) {
  // "Auto": light or dark with the device, and follow it when it changes
  if (systemMq) {
    systemMq.mq.removeEventListener("change", systemMq.fn);
    systemMq = null;
  }
  let id = themeId;
  if (themeId === "system") {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    id = mq.matches ? "light" : "dark";
    const fn = () => applyTheme("system");
    mq.addEventListener("change", fn);
    systemMq = { mq, fn };
  }
  const preset = THEME_PRESETS.find((t) => t.id === id) ?? THEME_PRESETS[0];
  const vars =
    (id === "custom" ? (customVars ?? DEFAULT_CUSTOM_VARS) : preset.vars) ?? THEME_PRESETS[0].vars;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
  // lets the CSS adapt the few things that assume a dark background
  const c = hexRgb(vars["--bg"]) || [0, 0, 0];
  const light = (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 150;
  root.setAttribute("data-theme-kind", light ? "light" : "dark");
  root.style.colorScheme = light ? "light" : "dark";
}
