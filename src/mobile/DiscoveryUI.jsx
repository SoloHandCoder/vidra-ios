// "Coming up" (upcoming episodes + releases) for Home and Library, with a
// full calendar page.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { imgUrl } from "../utils/api";
import { loadUpcoming, dayLabel, daysUntil } from "./discovery.js";
import "./libraryExtras.css";
import "./discovery.css";

export function useUpcoming(apiKey, saved, history) {
  const [items, setItems] = useState(null);
  const sig = `${apiKey ? 1 : 0}|${Object.keys(saved || {}).length}|${(history || []).length}`;
  useEffect(() => {
    let alive = true;
    if (!apiKey) {
      setItems([]);
      return;
    }
    loadUpcoming(apiKey, saved, history)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () =>
    loadUpcoming(apiKey, saved, history, { force: true })
      .then(setItems)
      .catch(() => {});
  return { items, refresh };
}

// open the show / movie (not the unaired episode itself)
const target = (it) => ({ id: it.id, media_type: it.media_type, title: it.title, name: it.title, poster_path: it.poster_path });

const epLabel = (it) =>
  it.kind === "movie" ? "Movie release" : `S${it.season}E${it.episode}${it.episodeName && !/^Episode \d+$/i.test(it.episodeName) ? ` · ${it.episodeName}` : ""}`;

function badge(it) {
  const n = daysUntil(it.date);
  return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n < 7 ? dayLabel(it.date) : `in ${n} days`;
}

/** Horizontal row for the Home page */
export function UpcomingRow({ apiKey, saved, history, onSelect }) {
  const { items } = useUpcoming(apiKey, saved, history);
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div className="section sbu-section">
      <div className="section-title sbu-title-row">
        <span>Coming up</span>
        <button className="sbx-link" onClick={() => setOpen(true)}>Calendar ›</button>
      </div>
      <div className="sbu-row">
        {items.slice(0, 15).map((it) => (
          <button key={`${it.kind}_${it.id}_${it.date}`} className="sbu-card" onClick={() => onSelect(target(it))} title={it.title}>
            <div className="sbu-poster">
              {it.poster_path && <img src={imgUrl(it.poster_path, "w342")} alt="" loading="lazy" />}
              <span className={`sbu-badge${daysUntil(it.date) <= 1 ? " soon" : ""}`}>{badge(it)}</span>
            </div>
            <div className="sbu-name">{it.title}</div>
            <div className="sbu-sub">{it.kind === "movie" ? "Movie" : `S${it.season}E${it.episode}`}</div>
          </button>
        ))}
      </div>
      {open && <CalendarPage items={items} onClose={() => setOpen(false)} onSelect={(it) => { setOpen(false); onSelect(it); }} />}
    </div>
  );
}

/** Compact list for the Library page */
export function UpcomingSection({ apiKey, saved, history, onSelect }) {
  const { items, refresh } = useUpcoming(apiKey, saved, history);
  const [open, setOpen] = useState(false);
  if (!apiKey || !items) return null;
  return (
    <div className="library-section" id="sb-upcoming">
      <div className="library-section-title sbx-title-row">
        <span>Coming up</span>
        {items.length > 0 && <button className="sbx-link" onClick={() => setOpen(true)}>Calendar ›</button>}
      </div>
      {items.length === 0 ? (
        <div className="sbx-muted sbx-empty-hint">
          New episodes of the shows you save or watch, and release dates of movies on your watchlist, show up here.
        </div>
      ) : (
        <div className="history-rows">
          {items.slice(0, 5).map((it) => (
            <Row key={`${it.kind}_${it.id}_${it.date}`} it={it} onSelect={onSelect} />
          ))}
        </div>
      )}
      {open && (
        <CalendarPage
          items={items}
          onRefresh={refresh}
          onClose={() => setOpen(false)}
          onSelect={(it) => {
            setOpen(false);
            onSelect(it);
          }}
        />
      )}
    </div>
  );
}

function Row({ it, onSelect, showWhen = true }) {
  return (
    <div className="history-row" onClick={() => onSelect(target(it))}>
      <div className="history-thumb">{it.poster_path && <img src={imgUrl(it.poster_path, "w92")} alt="" />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
        <div style={{ fontSize: 12, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{epLabel(it)}</div>
      </div>
      {showWhen && <span className={`sbu-when${daysUntil(it.date) <= 1 ? " soon" : ""}`}>{dayLabel(it.date)}</span>}
    </div>
  );
}

function CalendarPage({ items, onClose, onSelect, onRefresh }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const prev = window.__sbSheetBack;
    window.__sbSheetBack = () => (onClose(), true);
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => {
      window.__sbSheetBack = prev;
      window.removeEventListener("keydown", k);
    };
  }, [onClose]);
  const groups = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && g.date === it.date) g.items.push(it);
    else groups.push({ date: it.date, items: [it] });
  }
  return createPortal(
    <div className="sbx-page fade-in">
      <div className="sbx-page-bar">
        <button className="btn btn-ghost" onClick={onClose}>‹ Back</button>
        <div className="sbx-page-title">Coming up</div>
        {onRefresh && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRefresh();
              setBusy(false);
            }}
          >
            {busy ? "Checking…" : "Refresh"}
          </button>
        )}
      </div>
      <div className="sbx-page-body">
        {groups.map((g) => (
          <div key={g.date} className="sbu-day">
            <div className="sbu-day-head">
              <span className={daysUntil(g.date) <= 1 ? "soon" : ""}>{dayLabel(g.date)}</span>
              <span className="sbx-muted">
                {new Date(g.date + "T12:00:00").toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>
            <div className="history-rows">
              {g.items.map((it) => (
                <Row key={`${it.kind}_${it.id}`} it={it} onSelect={onSelect} showWhen={false} />
              ))}
            </div>
          </div>
        ))}
        <div className="sbx-muted" style={{ margin: "24px 0 40px", lineHeight: 1.6 }}>
          Shows you saved or watched, and movies on your watchlist, for the next 4 months. Air dates come from TMDB and
          can change.
        </div>
      </div>
    </div>,
    document.body,
  );
}
