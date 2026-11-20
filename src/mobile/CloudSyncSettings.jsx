// Settings → Cloud sync (Android): sync history, saved list, progress and
// watched episodes of every profile through a private GitHub Gist.
import { useEffect, useState } from "react";
import { native } from "./native.js";
import { connect, disconnect, getStatus, onStatus, setAuto, syncNow } from "./cloudSync.js";

function ago(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Streambert%20sync";

export default function CloudSyncSettings() {
  const [st, setSt] = useState(getStatus);
  const [tok, setTok] = useState("");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => onStatus(setSt), []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const doConnect = async () => {
    setBusy(true);
    try {
      await connect(tok);
      setTok("");
    } catch (e) {
      setSt({ ...getStatus(), lastError: String(e?.message || e) });
      return;
    } finally {
      setBusy(false);
    }
    setSt(getStatus());
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title" style={{ marginTop: 28 }}>
        Cloud sync
      </div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6 }}>
        Keeps history, saved titles, progress and watched episodes of every profile in sync between your devices.
        Everything is stored in a private (secret) Gist on your GitHub account. Your token stays on this device.
      </div>

      {!st.connected ? (
        <>
          <ol style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, paddingLeft: 20, marginBottom: 12 }}>
            <li>
              Create a token with only the <b>gist</b> permission:{" "}
              <a
                href={TOKEN_URL}
                onClick={(e) => {
                  e.preventDefault();
                  native.plugin.openExternal({ url: TOKEN_URL }).catch(() => {});
                }}
                style={{ color: "var(--red)" }}
              >
                open GitHub ↗
              </a>
            </li>
            <li>Copy it, paste it below and tap Connect.</li>
            <li>Do the same on your other devices with the same GitHub account.</li>
          </ol>
          <input
            className="apikey-input"
            style={{ marginBottom: 10 }}
            type="password"
            autoComplete="off"
            placeholder="GitHub token (ghp_… or github_pat_…)"
            value={tok}
            onChange={(e) => setTok(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || !tok.trim()} onClick={doConnect}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: st.lastError ? "#f2994a" : "#4caf50",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>Connected as {st.login}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                {st.syncing ? "Syncing…" : `Last synced ${ago(st.lastSync)}`}
              </div>
            </div>
            <button className="btn btn-secondary btn--sm" disabled={st.syncing} onClick={() => syncNow()}>
              Sync now
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 12px" }}>
            <button
              type="button"
              role="switch"
              aria-checked={st.auto}
              aria-label="Sync automatically"
              onClick={() => setAuto(!st.auto)}
              style={{
                background: st.auto ? "var(--red)" : "var(--surface2)",
                border: "1px solid " + (st.auto ? "var(--red)" : "var(--border)"),
                borderRadius: 20,
                width: 44,
                height: 24,
                position: "relative",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: st.auto ? 22 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left .2s",
                }}
              />
            </button>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Sync automatically</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                When the app opens, every 5 minutes, and when you leave it.
              </div>
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm("Disconnect cloud sync on this device? Your data stays on the device and in the Gist.")) {
                disconnect();
                setSt(getStatus());
              }
            }}
          >
            Disconnect
          </button>
        </>
      )}
      {st.lastError && <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>{st.lastError}</div>}
    </div>
  );
}
