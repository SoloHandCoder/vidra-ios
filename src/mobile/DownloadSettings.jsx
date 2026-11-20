// Android download settings (replaces the desktop "Download Folder" box):
// save location, Wi-Fi only, MP4 conversion.
import { useEffect, useState } from "react";
import { native } from "./native.js";
import { getAutoNext, setAutoNext, getStorageLimitGB, setStorageLimitGB } from "./smartDownloads.js";
import { QUALITIES, getDefaultQuality, setDefaultQuality } from "./quality.js";

const P = native.plugin;

function Switch({ value, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!value}
      aria-label={label}
      onClick={() => onChange(!value)}
      style={{
        background: value ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (value ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 44,
        height: 24,
        position: "relative",
        flexShrink: 0,
        transition: "background 0.2s, border-color 0.2s",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

function Row({ title, desc, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", flexWrap: "wrap" }}>
      {children}
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>{title}</div>
        {desc && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </div>
  );
}

const LOCATIONS = [
  { id: "app", label: "App storage", desc: "Private to Streambert. Removed if you uninstall the app." },
  { id: "movies", label: "Movies folder", desc: "Movies/Streambert on your phone: shows up in your gallery, VLC and file manager." },
  { id: "custom", label: "Choose folder…", desc: "Any folder, including an SD card." },
];

export default function AndroidDownloadSettings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState("");

  const load = () => P.getDownloadSettings().then(setS).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const flash = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2200);
  };

  const set = async (patch) => {
    try {
      setS(await P.setDownloadSettings(patch));
      flash("✓ Saved");
    } catch (e) {
      flash(String(e?.message || e));
    }
  };

  const pickLocation = async (id) => {
    if (id === "custom") {
      const r = await P.pickDownloadFolder().catch(() => ({ ok: false }));
      if (r?.ok) {
        await load();
        flash(`✓ Saving to “${r.folderName}”`);
      }
      return;
    }
    set({ location: id });
  };

  if (!s) return null;

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Save downloads to</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {LOCATIONS.map((l) => {
          const active = s.location === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => pickLocation(l.id)}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid " + (active ? "var(--red)" : "var(--border)"),
                background: active ? "var(--red-dim)" : "var(--surface2)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: "2px solid " + (active ? "var(--red)" : "var(--text3)"),
                    boxShadow: active ? "inset 0 0 0 3px var(--surface2)" : "none",
                    background: active ? "var(--red)" : "transparent",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {l.id === "custom" && s.location === "custom" && s.folderName
                    ? `Folder: ${s.folderName}`
                    : l.label}
                </span>
                {l.id === "custom" && s.location === "custom" && (
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--red)" }}>Change</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, marginLeft: 26, lineHeight: 1.5 }}>
                {l.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div className="settings-section-title">Download options</div>
      <Row
        title="Download on Wi-Fi only"
        desc="Downloads wait (and continue automatically) when you're on mobile data."
      >
        <Switch value={s.wifiOnly} onChange={(v) => set({ wifiOnly: v })} label="Wi-Fi only" />
      </Row>
      <Row
        title="Save as MP4"
        desc="Converts streams into a single .mp4 file after downloading, so other apps can play them. If a video can't be converted it's kept in the app's own format."
      >
        <Switch value={s.convertMp4} onChange={(v) => set({ convertMp4: v })} label="Save as MP4" />
      </Row>
      {msg && <div style={{ marginTop: 6, fontSize: 13, color: msg.startsWith("✓") ? "#4caf50" : "var(--red)" }}>{msg}</div>}
      <SmartDownloadSettings />
    </div>
  );
}

function Chips({ options, value, onPick }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={"btn btn--sm " + (value === v ? "btn-primary" : "btn-ghost")}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SmartDownloadSettings() {
  const [next, setNext] = useState(getAutoNext);
  const [limit, setLimit] = useState(getStorageLimitGB);
  const [quality, setQ] = useState(getDefaultQuality);
  const [used, setUsed] = useState(null);
  useEffect(() => {
    window.electron
      ?.getDownloadsSize?.()
      .then((r) => setUsed(r?.bytes ?? null))
      .catch(() => {});
  }, []);
  const gb = (b) => (b / 1e9 >= 10 ? Math.round(b / 1e9) : (b / 1e9).toFixed(1)) + " GB";
  return (
    <div style={{ marginTop: 26 }}>
      <div className="settings-section-title">Smart downloads</div>
      <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
        When you finish an episode, download the next ones of that show automatically. Only on Wi-Fi, using the
        source you watch with.
      </div>
      <Chips
        options={[[0, "Off"], [1, "Next 1"], [2, "Next 2"], [3, "Next 3"]]}
        value={next}
        onPick={(v) => {
          setAutoNext(v);
          setNext(v);
        }}
      />
      <div className="settings-section-title" style={{ marginTop: 26 }}>Download quality</div>
      <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
        The quality new downloads use (you can still pick another one per download). Lower quality saves space.
      </div>
      <Chips
        options={QUALITIES}
        value={quality}
        onPick={(v) => {
          setDefaultQuality(v);
          setQ(v);
        }}
      />
      <div className="settings-section-title" style={{ marginTop: 26 }}>Storage limit</div>
      <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
        New downloads (and smart downloads) stop once your downloads take up this much space.
        {used != null && ` Downloads use ${gb(used)} right now.`}
      </div>
      <Chips
        options={[[0, "No limit"], [5, "5 GB"], [10, "10 GB"], [25, "25 GB"], [50, "50 GB"], [100, "100 GB"]]}
        value={limit}
        onPick={(v) => {
          setStorageLimitGB(v);
          setLimit(v);
        }}
      />
    </div>
  );
}
