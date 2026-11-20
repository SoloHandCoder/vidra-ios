// Settings → Notifications: release-time episode reminders + followed people.
import { useState } from "react";
import { remindersOn, setRemindersOn, reminderHour, setReminderHour } from "./reminders.js";
import { getFollowed, toggleFollow } from "./people.js";
import { imgUrl } from "../utils/api";

const HOURS = [6, 8, 9, 12, 15, 18, 20, 22];
const changed = () => window.dispatchEvent(new Event("streambert:reminders-changed"));

export default function ReminderSettings() {
  const [on, setOn] = useState(remindersOn);
  const [hour, setHour] = useState(reminderHour);
  const [people, setPeople] = useState(() => Object.values(getFollowed()));
  const fmt = (h) => new Date(2020, 0, 1, h).toLocaleTimeString(document.documentElement.lang || undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div style={{ marginBottom: 40, maxWidth: 680 }}>
      <div className="settings-section-title">Episode reminders</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Episode reminders"
          onClick={() => {
            setRemindersOn(!on);
            setOn(!on);
            changed();
          }}
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
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Remind me on release day</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, lineHeight: 1.5 }}>
            A notification on the day a new episode of a show you saved or watch comes out.
            {!window.electron?.isMobile && " Shown while Streambert is open (or when you open it that day)."}
          </div>
        </div>
      </div>
      {on && (
        <>
          <div style={{ fontSize: 13, color: "var(--text3)", margin: "10px 0 8px" }}>Remind me at</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                className={"btn btn--sm " + (hour === h ? "btn-primary" : "btn-ghost")}
                onClick={() => {
                  setReminderHour(h);
                  setHour(h);
                  changed();
                }}
              >
                {fmt(h)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="settings-section-title" style={{ marginTop: 28 }}>People you follow</div>
      {people.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
          Open an actor or director from "Cast" on any movie or show and tap Follow. You'll be told when they're in
          something new.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {people.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
              {p.profile_path ? (
                <img src={imgUrl(p.profile_path, "w92")} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{p.name[0]}</span>
              )}
              <button className="sbx-link" style={{ flex: 1, textAlign: "left", color: "var(--text)", fontSize: 14 }} onClick={() => window.__sbNav?.person?.(p)} data-no-i18n>
                {p.name}
              </button>
              <button
                className="btn btn-ghost btn--sm"
                onClick={() => {
                  toggleFollow(p);
                  setPeople(Object.values(getFollowed()));
                }}
              >
                Unfollow
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
