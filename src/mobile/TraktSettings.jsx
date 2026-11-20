// Settings → Profiles & Sync → Trakt
import { useEffect, useRef, useState } from "react";
import {
  connectTrakt,
  disconnectTrakt,
  getTraktApp,
  getTraktAuth,
  getTraktOpts,
  importFromTrakt,
  setTraktApp,
  setTraktOpts,
} from "./trakt.js";

const open = (url) => (window.electron?.openExternal ? window.electron.openExternal(url) : window.open(url, "_blank"));

function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        background: on ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (on ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 44,
        height: 24,
        position: "relative",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 22 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
    </button>
  );
}

export default function TraktSettings({ apiKey }) {
  const [app, setApp] = useState(() => getTraktApp() || { clientId: "", clientSecret: "" });
  const [auth, setAuth] = useState(getTraktAuth);
  const [opts, setOpts] = useState(getTraktOpts);
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const cancel = useRef(false);
  useEffect(() => () => (cancel.current = true), []);
  const editApp = !getTraktApp()?.clientId || !getTraktApp()?.clientSecret;

  const connect = async () => {
    setMsg("");
    if (!app.clientId.trim() || !app.clientSecret.trim()) return setMsg("Paste both the Client ID and the Client Secret.");
    setTraktApp(app.clientId, app.clientSecret);
    setBusy("connect");
    cancel.current = false;
    try {
      const a = await connectTrakt((c) => setCode(c), () => cancel.current);
      setAuth(a);
      setMsg(`✓ Connected as ${a.user}. You can import your Trakt data now.`);
    } catch (e) {
      if (String(e.message) !== "cancelled") setMsg(String(e.message || e));
    } finally {
      setCode(null);
      setBusy("");
    }
  };
  const doImport = async () => {
    if (!apiKey) return setMsg("Add your TMDB token first.");
    setBusy("import");
    setMsg("");
    try {
      const c = await importFromTrakt(apiKey, (t) => setMsg(t));
      setMsg(`✓ Imported ${c.watched} watched episodes/movies, ${c.ratings} ratings and ${c.watchlist} watchlist titles.`);
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy("");
    }
  };
  const opt = (k) => (v) => {
    setTraktOpts({ [k]: v });
    setOpts(getTraktOpts());
  };
  const row = { display: "flex", alignItems: "center", gap: 12, padding: "6px 0" };

  return (
    <div style={{ marginBottom: 40, maxWidth: 680 }}>
      <div className="settings-section-title">Trakt</div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
        Import your Trakt history, ratings and watchlist, and keep Trakt up to date while you watch. Linked per profile.
      </div>

      {!auth?.access_token && (
        <>
          {(editApp || !code) && (
            <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, marginBottom: 10 }}>
              1. On trakt.tv, create a free API app (Settings → Your API Apps → New Application). Use{" "}
              <code>urn:ietf:wg:oauth:2.0:oob</code> as the redirect URI.{" "}
              <button className="sbx-link" onClick={() => open("https://trakt.tv/oauth/applications/new")}>Open trakt.tv ›</button>
              <br />
              2. Paste its Client ID and Client Secret here, then tap Connect.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
            <input className="apikey-input" placeholder="Client ID" value={app.clientId} onChange={(e) => setApp({ ...app, clientId: e.target.value })} autoComplete="off" />
            <input className="apikey-input" placeholder="Client Secret" type="password" value={app.clientSecret} onChange={(e) => setApp({ ...app, clientSecret: e.target.value })} autoComplete="off" />
          </div>
          {code ? (
            <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>Go to</div>
              <button className="sbx-link" style={{ fontSize: 15 }} onClick={() => open(code.verification_url || "https://trakt.tv/activate")}>
                {code.verification_url || "https://trakt.tv/activate"}
              </button>
              <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 6 }}>and enter this code:</div>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 4, margin: "6px 0", fontFamily: "monospace" }} data-no-i18n>
                {code.user_code}
              </div>
              <div className="sbx-muted">Waiting for you to approve it on Trakt…</div>
              <button className="btn btn-ghost btn--sm" style={{ marginTop: 8 }} onClick={() => (cancel.current = true)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy === "connect"} onClick={connect}>
              {busy === "connect" ? "Connecting…" : "Connect Trakt"}
            </button>
          )}
        </>
      )}

      {auth?.access_token && (
        <>
          <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 10 }}>
            Connected as <b data-no-i18n>{auth.user || "Trakt"}</b>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button className="btn btn-primary" disabled={!!busy} onClick={doImport}>
              {busy === "import" ? "Importing…" : "Import from Trakt"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                disconnectTrakt();
                setAuth(null);
                setMsg("");
              }}
            >
              Disconnect
            </button>
          </div>
          <div style={row}>
            <Toggle on={opts.scrobble} onChange={opt("scrobble")} label="Show what I'm watching" />
            <div style={{ fontSize: 14, color: "var(--text)" }}>Show what I'm watching on Trakt</div>
          </div>
          <div style={row}>
            <Toggle on={opts.history} onChange={opt("history")} label="Add to Trakt history" />
            <div style={{ fontSize: 14, color: "var(--text)" }}>Add what I finish to my Trakt history</div>
          </div>
          <div style={row}>
            <Toggle on={opts.ratings} onChange={opt("ratings")} label="Send my ratings" />
            <div style={{ fontSize: 14, color: "var(--text)" }}>Send my ratings to Trakt</div>
          </div>
        </>
      )}
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith("✓") ? "#4caf50" : "var(--text2)", lineHeight: 1.5 }}>{msg}</div>}
    </div>
  );
}
