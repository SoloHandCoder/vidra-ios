// Watch-time goals UI: the "Goal" button + sheet on the show page and the
// "Watch goals" section in the library.
import { useEffect, useMemo, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, airedPlan, daysText, getGoal, getGoals, goalProgress, leftText, onGoals, paceText, progressFor, refreshGoal, removeGoal, setGoal } from "./goals.js";
import "./goals.css";

// re-read goals / watched episodes now and then (they change elsewhere in the app)
function useGoalsTick() {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const off = onGoals(bump);
    const t = setInterval(bump, 8000);
    const vis = () => !document.hidden && bump();
    document.addEventListener("visibilitychange", vis);
    return () => {
      off();
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
}

const fmtDate = (iso) => {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: iso.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric" });
  } catch {
    return iso;
  }
};

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = window.__sbSheetBack;
    window.__sbSheetBack = () => (onClose(), true);
    return () => {
      window.removeEventListener("keydown", k);
      window.__sbSheetBack = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="sbx-sheet-overlay" onClick={onClose}>
      <div className="sbx-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sbx-sheet-handle" />
        <div className="sbx-sheet-title">{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function TargetIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

function Bar({ p }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="sbg-bar" aria-label={`${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** one line: "2 episodes a day · about 90 min a day" or the finished / overdue state */
function PaceLine({ p }) {
  if (p.finished) return <span className="sbg-done">🎉 Finished!</span>;
  if (p.overdue) return <span className="sbg-late">Goal date passed</span>;
  return (
    <span>
      <b>{paceText(p)}</b>
      {p.pace?.minutes ? (
        <>
          {" · "}
          <span>{`about ${p.pace.minutes} min a day`}</span>
        </>
      ) : null}
    </span>
  );
}

/** "Goal" button for the show page (d = TMDB show details) */
export function GoalButton({ show }) {
  useGoalsTick();
  const [open, setOpen] = useState(false);
  const goal = show?.id ? getGoal(show.id) : null;
  useEffect(() => {
    if (show?.seasons) refreshGoal(show);
  }, [show]);
  if (!show?.id) return null;
  const p = goal ? goalProgress(goal) : null;
  return (
    <>
      <button className={`btn btn-secondary sbg-btn${goal ? " on" : ""}`} onClick={() => setOpen(true)}>
        <TargetIcon />
        {!goal ? "Set a goal" : p.finished ? "Goal reached" : p.overdue ? "Goal passed" : paceText(p) || "Goal"}
      </button>
      {open && <GoalSheet show={show} onClose={() => setOpen(false)} />}
    </>
  );
}

const QUICK = [
  ["1 week", 7],
  ["2 weeks", 14],
  ["1 month", 30],
  ["3 months", 91],
];

function GoalSheet({ show, onClose }) {
  const existing = getGoal(show.id);
  const [by, setBy] = useState(existing?.by || addDays(14));
  const plan = useMemo(() => airedPlan(show) || existing?.plan || [], [show, existing]);
  const runtime = existing?.runtime || (show.episode_run_time || [])[0] || show.last_episode_to_air?.runtime || null;
  const p = progressFor(show.id, plan, by, runtime);
  const valid = by >= addDays(0);
  return (
    <Sheet title={`Watch goal · ${show.name || show.title || ""}`} onClose={onClose}>
      {!plan.length ? (
        <div className="sbx-muted">No episodes have aired yet.</div>
      ) : (
        <div className="sbg-sheet">
          <label className="sbg-label">Finish by</label>
          <input className="sbx-input" type="date" value={by} min={addDays(0)} onChange={(e) => e.target.value && setBy(e.target.value)} />
          <div className="sbg-chips">
            {QUICK.map(([l, n]) => (
              <button key={l} className={`sbg-chip${by === addDays(n) ? " on" : ""}`} onClick={() => setBy(addDays(n))}>
                {l}
              </button>
            ))}
          </div>
          <div className="sbg-preview">
            <div className="sbg-row">
              <span>{leftText(p.left)}</span>
              <span className="sbx-muted">{daysText(p.daysLeft)}</span>
            </div>
            <Bar p={p} />
            <div className="sbg-pace">
              <PaceLine p={p} />
            </div>
          </div>
          <button className="btn btn-primary sbx-full" disabled={!valid || p.finished} onClick={() => (setGoal(show, by), onClose())}>
            {existing ? "Update goal" : "Save goal"}
          </button>
          {existing && (
            <button className="btn btn-ghost sbx-full" onClick={() => (removeGoal(show.id), onClose())}>
              Remove goal
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** "Watch goals" section in the library */
export function GoalsSection({ onSelect }) {
  useGoalsTick();
  const goals = Object.values(getGoals()).sort((a, b) => String(a.by).localeCompare(String(b.by)));
  if (!goals.length) return null;
  return (
    <div className="library-section" id="sb-watch-goals">
      <div className="library-section-title">Watch goals</div>
      <div className="sbg-list">
        {goals.map((g) => {
          const p = goalProgress(g);
          return (
            <div key={g.id} className="sbg-item" role="button" tabIndex={0} onClick={() => onSelect?.({ id: g.id, media_type: "tv", name: g.title, title: g.title, poster_path: g.poster_path })}>
              {g.poster_path ? <img src={`https://image.tmdb.org/t/p/w92${g.poster_path}`} alt="" loading="lazy" /> : <div className="sbg-ph" />}
              <div className="sbg-text">
                <div className="sbg-row">
                  <span className="sbg-title" data-no-i18n>{g.title}</span>
                  <span className="sbx-muted sbg-by">{`Finish by ${fmtDate(g.by)}`}</span>
                </div>
                <Bar p={p} />
                <div className="sbg-row sbg-small">
                  <PaceLine p={p} />
                  {!p.finished && <span className="sbx-muted">{leftText(p.left)}</span>}
                </div>
              </div>
              {p.finished && (
                <button
                  className="icon-btn"
                  aria-label="Remove goal"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeGoal(g.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
