// Settings → Profiles & privacy (Android): manage profiles and the app lock.
import { useEffect, useState } from "react";
import { guardKids, hasParentPin, setParentPin } from "./kids.js";
import { native } from "./native.js";
import {
  COLORS,
  getMeta,
  createProfile,
  updateProfile,
  deleteProfile,
  switchProfile,
  setAskOnStart,
} from "./profiles.js";

const P = native.plugin;

function Avatar({ p, size = 44 }) {
  return (
    <span
      className="sb-avatar"
      style={{ width: size, height: size, background: p.color, fontSize: Math.round(size * 0.46) }}
    >
      {(p.name || "?").trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Switch({ value, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        background: value ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (value ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 44,
        height: 24,
        position: "relative",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.2s",
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

const TIMEOUTS = [
  { ms: 0, label: "Immediately" },
  { ms: 60_000, label: "After 1 minute" },
  { ms: 300_000, label: "After 5 minutes" },
  { ms: 900_000, label: "After 15 minutes" },
];

export default function ProfilesPrivacy() {
  const [meta, setMeta] = useState(getMeta);
  const [editing, setEditing] = useState(null); // {id|null, name, color}
  const [lock, setLock] = useState(null);
  const [msg, setMsg] = useState("");

  const refresh = () => setMeta(getMeta());
  useEffect(() => {
    P.getLockSettings().then(setLock).catch(() => {});
  }, []);

  const flash = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2600);
  };

  const [pinErr, setPinErr] = useState("");
  const saveEdit = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    if (editing.kids && !hasParentPin()) {
      if (!/^\d{4,12}$/.test(editing.pin1 || "")) return setPinErr("Choose a parent PIN of 4 to 12 digits.");
      if (editing.pin1 !== editing.pin2) return setPinErr("The two PINs don't match.");
      await setParentPin(editing.pin1);
    }
    setPinErr("");
    const kidsPatch = { kids: !!editing.kids, ageLimit: editing.ageLimit ?? 12 };
    if (editing.id) updateProfile(editing.id, { name, color: editing.color, ...kidsPatch });
    else createProfile(name, editing.color, kidsPatch);
    setEditing(null);
    refresh();
  };

  const setLockOpt = async (patch) => {
    try {
      setLock(await P.setLockSettings(patch));
    } catch (e) {
      flash(String(e?.message || e));
    }
  };

  const row = { display: "flex", alignItems: "center", gap: 12, padding: "10px 0" };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Profiles</div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
        Each profile has its own history, saved list, progress and watched episodes. Settings and downloads are
        shared.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {meta.list.map((p) => {
          const cur = p.id === meta.current;
          return (
            <div
              key={p.id}
              style={{
                ...row,
                padding: "10px 12px",
                borderRadius: 10,
                background: cur ? "var(--red-dim)" : "var(--surface2)",
                border: "1px solid " + (cur ? "var(--red)" : "var(--border)"),
              }}
            >
              <Avatar p={p} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
                  {p.name} {p.kids && <span className="sb-kids-badge" style={{ marginLeft: 6 }}>KIDS · {p.ageLimit ?? 12}+</span>}
                </div>
                <div style={{ fontSize: 12, color: cur ? "var(--red)" : "var(--text3)" }}>
                  {cur ? "Watching now" : "Tap Switch to use this profile"}
                </div>
              </div>
              {!cur && (
                <button className="btn btn-secondary btn--sm" onClick={() => guardKids("Leaving a kids profile needs the parent PIN.", () => switchProfile(p.id))}>
                  Switch
                </button>
              )}
              <button
                className="icon-btn"
                aria-label={`Edit ${p.name}`}
                onClick={() => setEditing({ id: p.id, name: p.name, color: p.color, kids: !!p.kids, ageLimit: p.ageLimit ?? 12 })}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
            </div>
          );
        })}
      </div>

      {editing ? (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
          <input
            className="apikey-input"
            style={{ marginBottom: 12 }}
            placeholder="Name"
            maxLength={24}
            value={editing.name}
            autoFocus
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && saveEdit()}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setEditing({ ...editing, color: c })}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: c,
                  border: editing.color === c ? "3px solid #fff" : "3px solid transparent",
                  boxShadow: editing.color === c ? "0 0 0 2px " + c : "none",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0 12px" }}>
            <Switch
              value={!!editing.kids}
              label="Kids profile"
              onChange={(v) => setEditing({ ...editing, kids: v })}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Kids profile</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, lineHeight: 1.5 }}>
                Only titles up to its age limit. Leaving it or opening Settings needs the parent PIN.
              </div>
            </div>
          </div>
          {editing.kids && (
            <div style={{ margin: "0 0 14px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 8 }}>Age limit</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[6, 9, 12, 14, 16].map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={"btn btn--sm " + ((editing.ageLimit ?? 12) === a ? "btn-primary" : "btn-ghost")}
                    onClick={() => setEditing({ ...editing, ageLimit: a })}
                  >
                    {a}+
                  </button>
                ))}
              </div>
              {!hasParentPin() && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, maxWidth: 260 }}>
                  <div style={{ fontSize: 13, color: "var(--text3)" }}>Set a parent PIN (asked to leave the kids profile)</div>
                  <input className="apikey-input" type="password" inputMode="numeric" maxLength={12} placeholder="Parent PIN (4–12 digits)"
                    value={editing.pin1 || ""} onChange={(e) => setEditing({ ...editing, pin1: e.target.value.replace(/\D/g, "") })} />
                  <input className="apikey-input" type="password" inputMode="numeric" maxLength={12} placeholder="Repeat PIN"
                    value={editing.pin2 || ""} onChange={(e) => setEditing({ ...editing, pin2: e.target.value.replace(/\D/g, "") })} />
                </div>
              )}
              {pinErr && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{pinErr}</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={saveEdit} disabled={!editing.name.trim()}>
              {editing.id ? "Save" : "Add profile"}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing.id && editing.id !== meta.current && (
              <button
                className="btn btn-ghost"
                style={{ color: "var(--red)", marginLeft: "auto" }}
                onClick={() => {
                  if (confirm(`Delete profile “${editing.name}” and its history?`)) {
                    deleteProfile(editing.id);
                    setEditing(null);
                    refresh();
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ) : (
        meta.list.length < 8 && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => setEditing({ id: null, name: "", color: COLORS[meta.list.length % COLORS.length] })}
          >
            + Add profile
          </button>
        )
      )}

      {meta.list.length > 1 && (
        <div style={{ ...row, marginTop: 8 }}>
          <Switch
            value={meta.askOnStart}
            label="Ask who's watching"
            onChange={(v) => {
              setAskOnStart(v);
              refresh();
            }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Ask “Who's watching?” on start</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>Shows the profile picker when the app opens.</div>
          </div>
        </div>
      )}

      <div className="settings-section-title" style={{ marginTop: 28 }}>
        App lock
      </div>
      {lock && (
        <>
          <div style={row}>
            <Switch
              value={lock.enabled}
              label="App lock"
              disabled={!lock.available && !lock.enabled}
              onChange={(v) => setLockOpt({ enabled: v })}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Lock Vidra</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, lineHeight: 1.5 }}>
                {lock.available
                  ? "Unlock with your fingerprint, face or your phone's PIN / pattern."
                  : lock.reason}
              </div>
            </div>
          </div>
          {lock.enabled && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {TIMEOUTS.map((t) => (
                <button
                  key={t.ms}
                  type="button"
                  className={"btn btn--sm " + (lock.timeoutMs === t.ms ? "btn-primary" : "btn-ghost")}
                  onClick={() => setLockOpt({ timeoutMs: t.ms })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="settings-section-title" style={{ marginTop: 28 }}>
        Home-screen widget
      </div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 10, lineHeight: 1.6 }}>
        “Continue watching” shows your last 3 titles on your home screen. Tap one to jump back in.
      </div>
      <button
        className="btn btn-secondary"
        onClick={async () => {
          const r = await P.pinWidget().catch(() => ({ ok: false }));
          if (!r?.ok) flash("Long-press your home screen → Widgets → Vidra to add it.");
        }}
      >
        Add widget to home screen
      </button>
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>{msg}</div>}
    </div>
  );
}
