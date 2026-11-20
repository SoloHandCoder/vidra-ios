import { shareStatsCard } from "./statsCard.js";
// Personal ratings, custom lists and watch statistics UI (Android build).
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import MediaCard from "../components/MediaCard";
import { imgUrl, tmdbFetch } from "../utils/api";
import {
  K_LISTS,
  K_RATINGS,
  K_STATS,
  createList,
  dayKey,
  deleteList,
  getMyRating,
  getStats,
  itemKey,
  renameList,
  setMyRating,
  toggleInList,
  useLibraryExtras,
} from "./libraryExtras.js";
import "./libraryExtras.css";

// ── bottom sheet ─────────────────────────────────────────────────────────────
function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    // Android back closes the sheet first
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

function Star({ on, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={on ? "var(--gold, #f5c518)" : "none"}
        stroke={on ? "var(--gold, #f5c518)" : "currentColor"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const RATING_WORDS = ["", "Didn't like it", "It was OK", "Liked it", "Really liked it", "Loved it"];

// ── "Rate" button on the Movie / TV page ─────────────────────────────────────
export function RateButton({ item }) {
  useLibraryExtras([K_RATINGS]);
  const [open, setOpen] = useState(false);
  const mine = getMyRating(item);
  return (
    <>
      <button className="btn btn-secondary sbx-rate-btn" onClick={() => setOpen(true)}>
        <Star on={mine > 0} size={16} />
        {mine ? `${mine}/5` : "Rate"}
      </button>
      {open && <RateSheet item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

function RateSheet({ item, onClose }) {
  const [v, setV] = useState(getMyRating(item));
  const choose = (n) => {
    setV(n);
    setMyRating(item, n);
    setTimeout(onClose, 250);
  };
  return (
    <Sheet title={`Your rating · ${item.title || item.name || ""}`} onClose={onClose}>
      <div className="sbx-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="sbx-star" aria-label={`${n} stars`} onClick={() => choose(n)}>
            <Star on={n <= v} size={40} />
          </button>
        ))}
      </div>
      <div className="sbx-rate-word">{RATING_WORDS[v] || "Tap a star"}</div>
      {v > 0 && (
        <button className="btn btn-ghost sbx-full" onClick={() => choose(0)}>
          Remove my rating
        </button>
      )}
    </Sheet>
  );
}

// ── "Lists" button on the Movie / TV page ────────────────────────────────────
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h8M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function ListsButton({ item }) {
  const { lists } = useLibraryExtras([K_LISTS]);
  const [open, setOpen] = useState(false);
  const k = itemKey(item);
  const inCount = Object.values(lists).filter((l) => l.items?.[k]).length;
  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        <ListIcon />
        {inCount ? `In ${inCount} list${inCount > 1 ? "s" : ""}` : "Add to list"}
      </button>
      {open && <ListsSheet item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

function ListsSheet({ item, onClose }) {
  const { lists } = useLibraryExtras([K_LISTS]);
  const [name, setName] = useState("");
  const k = itemKey(item);
  const sorted = Object.values(lists).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const id = createList(n);
    toggleInList(id, item);
    setName("");
  };
  return (
    <Sheet title="Add to list" onClose={onClose}>
      <div className="sbx-list-rows">
        {sorted.length === 0 && <div className="sbx-muted">No lists yet. Make your first one below.</div>}
        {sorted.map((l) => {
          const on = !!l.items?.[k];
          return (
            <button key={l.id} className={`sbx-list-row${on ? " on" : ""}`} onClick={() => toggleInList(l.id, item)}>
              <span className="sbx-check">{on ? "✓" : ""}</span>
              <span className="sbx-list-name">{l.name}</span>
              <span className="sbx-muted">{Object.keys(l.items || {}).length}</span>
            </button>
          );
        })}
      </div>
      <form
        className="sbx-new-list"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="sbx-input"
          placeholder="New list name (e.g. Halloween)"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
          Create
        </button>
      </form>
    </Sheet>
  );
}

// ── Library: My Lists ────────────────────────────────────────────────────────
function Posters({ items }) {
  const p = items.filter((i) => i.poster_path).slice(0, 3);
  return (
    <div className="sbx-posters">
      {p.length === 0 && <div className="sbx-poster sbx-poster-empty"><ListIcon /></div>}
      {p.map((i, n) => (
        <img key={n} className="sbx-poster" style={{ zIndex: 3 - n, marginLeft: n ? -26 : 0 }} src={imgUrl(i.poster_path, "w92")} alt="" />
      ))}
    </div>
  );
}

export function MyListsSection({ onSelect, watched, onMarkWatched, onMarkUnwatched }) {
  const { lists } = useLibraryExtras([K_LISTS]);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const sorted = Object.values(lists).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const openList = openId && lists[openId];

  return (
    <div className="library-section" id="sb-my-lists">
      <div className="library-section-title sbx-title-row">
        <span>My Lists{sorted.length ? ` (${sorted.length})` : ""}</span>
        <button className="sbx-link" onClick={() => setCreating(true)}>+ New list</button>
      </div>
      {sorted.length === 0 ? (
        <div className="sbx-muted sbx-empty-hint">
          Group titles your way, like "Date night" or "Watch with kids". Use "Add to list" on any movie or show.
        </div>
      ) : (
        <div className="sbx-list-cards">
          {sorted.map((l) => {
            const items = Object.values(l.items || {}).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
            return (
              <button key={l.id} className="sbx-list-card" onClick={() => setOpenId(l.id)}>
                <Posters items={items} />
                <div className="sbx-list-card-text">
                  <div className="sbx-list-name">{l.name}</div>
                  <div className="sbx-muted">{items.length} title{items.length === 1 ? "" : "s"}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {creating && <NewListSheet onClose={() => setCreating(false)} onCreated={(id) => setOpenId(id)} />}
      {openList && (
        <ListView
          list={openList}
          onClose={() => setOpenId(null)}
          onSelect={(it) => {
            setOpenId(null);
            onSelect(it);
          }}
          watched={watched}
          onMarkWatched={onMarkWatched}
          onMarkUnwatched={onMarkUnwatched}
        />
      )}
    </div>
  );
}

function NewListSheet({ onClose, onCreated, initial = "", title = "New list", onSave }) {
  const [name, setName] = useState(initial);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="sbx-new-list"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          if (onSave) onSave(n);
          else onCreated?.(createList(n));
          onClose();
        }}
      >
        <input className="sbx-input" autoFocus placeholder="List name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </Sheet>
  );
}

function ListView({ list, onClose, onSelect, watched, onMarkWatched, onMarkUnwatched }) {
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const items = Object.values(list.items || {}).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  useEffect(() => {
    const prev = window.__sbSheetBack;
    window.__sbSheetBack = () => (onClose(), true);
    return () => (window.__sbSheetBack = prev);
  }, [onClose]);
  return createPortal(
    <div className="sbx-page fade-in">
      <div className="sbx-page-bar">
        <button className="btn btn-ghost" onClick={onClose}>‹ Back</button>
        <div className="sbx-page-title">{list.name}</div>
        <button className="btn btn-ghost" onClick={() => setRenaming(true)}>Rename</button>
        <button className="btn btn-ghost sbx-danger" onClick={() => setConfirmDel(true)}>Delete</button>
      </div>
      <div className="sbx-page-body">
        {items.length === 0 ? (
          <div className="sbx-muted sbx-empty-hint">This list is empty. Open a movie or show and tap "Add to list".</div>
        ) : (
          <div className="cards-grid">
            {items.map((it) => (
              <div key={itemKey(it)} className="sbx-card-wrap">
                <MediaCard item={it} onClick={() => onSelect(it)} watched={watched} onMarkWatched={onMarkWatched} onMarkUnwatched={onMarkUnwatched} />
                <button className="sbx-remove" title="Remove from list" onClick={() => toggleInList(list.id, it)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {renaming && (
        <NewListSheet title="Rename list" initial={list.name} onClose={() => setRenaming(false)} onSave={(n) => renameList(list.id, n)} />
      )}
      {confirmDel && (
        <Sheet title={`Delete "${list.name}"?`} onClose={() => setConfirmDel(false)}>
          <div className="sbx-muted" style={{ marginBottom: 16 }}>The titles stay in your library; only the list goes away.</div>
          <div className="sbx-row-btns">
            <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                deleteList(list.id);
                setConfirmDel(false);
                onClose();
              }}
            >
              Delete list
            </button>
          </div>
        </Sheet>
      )}
    </div>,
    document.body,
  );
}

// ── Library: Watch statistics ────────────────────────────────────────────────
const fmtHours = (secs) => {
  const h = secs / 3600;
  if (h >= 10) return `${Math.round(h)} h`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(secs / 60)} min`;
};

function streakOf(days) {
  let n = 0;
  const d = new Date();
  if (!(days[dayKey(d)] >= 60)) d.setDate(d.getDate() - 1); // today not started yet
  while (days[dayKey(d)] >= 60) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function summarize(stats, year) {
  const inYear = (k) => !year || k.startsWith(String(year));
  let total = 0, best = 0, bestStreak = 0, run = 0, prev = null;
  const months = new Array(12).fill(0);
  for (const k of Object.keys(stats.days).sort()) {
    if (!inYear(k)) continue;
    const s = stats.days[k];
    total += s;
    best = Math.max(best, s);
    months[Number(k.slice(5, 7)) - 1] += s;
    if (s >= 60) {
      const d = new Date(k + "T12:00:00");
      const p = prev && new Date(prev + "T12:00:00");
      run = p && (d - p) / 86400000 < 1.5 ? run + 1 : 1;
      prev = k;
      bestStreak = Math.max(bestStreak, run);
    }
  }
  return { total, best, bestStreak, months };
}

export function StatsSection({ apiKey, onSelect }) {
  useLibraryExtras([K_STATS]);
  const [open, setOpen] = useState(false);
  const stats = getStats();
  const total = Object.values(stats.days).reduce((a, b) => a + b, 0);
  const week = useMemo(() => {
    const out = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      out.push({ k: dayKey(x), label: x.toLocaleDateString(document.documentElement.lang || undefined, { weekday: "narrow" }), s: stats.days[dayKey(x)] || 0 });
    }
    return out;
  }, [stats]);
  const weekTotal = week.reduce((a, b) => a + b.s, 0);
  const max = Math.max(1, ...week.map((w) => w.s));

  return (
    <div className="library-section" id="sb-watch-stats">
      <div className="library-section-title sbx-title-row">
        <span>Watch Stats</span>
        {total > 0 && <button className="sbx-link" onClick={() => setOpen(true)}>See all ›</button>}
      </div>
      {total === 0 ? (
        <div className="sbx-muted sbx-empty-hint">Your watch time, streaks and a yearly recap will show up here once you start watching.</div>
      ) : (
        <button className="sbx-stats-card" onClick={() => setOpen(true)}>
          <div className="sbx-stat-row">
            <div><div className="sbx-big">{fmtHours(weekTotal)}</div><div className="sbx-muted">last 7 days</div></div>
            <div><div className="sbx-big">{streakOf(stats.days)}</div><div className="sbx-muted">day streak</div></div>
            <div><div className="sbx-big">{fmtHours(total)}</div><div className="sbx-muted">all time</div></div>
          </div>
          <div className="sbx-bars">
            {week.map((w) => (
              <div key={w.k} className="sbx-bar-col">
                <div className="sbx-bar" style={{ height: `${Math.max(3, (w.s / max) * 100)}%`, opacity: w.s ? 1 : 0.25 }} />
                <div className="sbx-bar-label">{w.label}</div>
              </div>
            ))}
          </div>
        </button>
      )}
      {open && <StatsPage apiKey={apiKey} onClose={() => setOpen(false)} onSelect={(it) => { setOpen(false); onSelect(it); }} />}
    </div>
  );
}

const GENRE_CACHE = "streambert_genreCache";
function useGenres(titles, apiKey) {
  const [map, setMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(GENRE_CACHE)) || {}; } catch { return {}; }
  });
  useEffect(() => {
    if (!apiKey) return;
    const need = titles.filter((t) => !t.genres?.length && !map[`${t.media_type}_${t.id}`]).slice(0, 20);
    if (!need.length) return;
    let alive = true;
    Promise.all(
      need.map((t) =>
        tmdbFetch(`/${t.media_type}/${t.id}`, apiKey)
          .then((d) => [`${t.media_type}_${t.id}`, (d?.genres || []).map((g) => g.name)])
          .catch(() => null),
      ),
    ).then((res) => {
      if (!alive) return;
      const next = { ...map };
      for (const r of res) if (r) next[r[0]] = r[1];
      try { localStorage.setItem(GENRE_CACHE, JSON.stringify(next)); } catch {}
      setMap(next);
    });
    return () => { alive = false; };
  }, [titles, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (t) => (t.genres?.length ? t.genres : map[`${t.media_type}_${t.id}`] || []);
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2020, i, 1).toLocaleDateString(document.documentElement.lang || undefined, { month: "short" }).replace(".", ""));

function StatsPage({ apiKey, onClose, onSelect }) {
  useLibraryExtras([K_STATS]);
  const stats = getStats();
  const years = [...new Set(Object.keys(stats.days).map((k) => Number(k.slice(0, 4))))].sort((a, b) => b - a);
  const [year, setYear] = useState(years[0] || new Date().getFullYear());
  useEffect(() => {
    const prev = window.__sbSheetBack;
    window.__sbSheetBack = () => (onClose(), true);
    return () => (window.__sbSheetBack = prev);
  }, [onClose]);

  // titles watched in the chosen year (by last watch), plus all-time list
  const allTitles = useMemo(() => Object.values(stats.titles).sort((a, b) => b.secs - a.secs), [stats]);
  const genresOf = useGenres(allTitles, apiKey);
  const yearTitles = allTitles.filter((t) => t.lastAt && new Date(t.lastAt).getFullYear() === year);
  const y = summarize(stats, year);
  const all = summarize(stats, null);
  const movies = yearTitles.filter((t) => t.media_type === "movie");
  const shows = yearTitles.filter((t) => t.media_type === "tv");
  const genreTotals = {};
  for (const t of yearTitles) for (const g of genresOf(t)) genreTotals[g] = (genreTotals[g] || 0) + t.secs;
  const topGenres = Object.entries(genreTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const busiest = y.months.indexOf(Math.max(...y.months));
  const monthMax = Math.max(1, ...y.months);
  const top = yearTitles[0];
  const [sharing, setSharing] = useState(false);

  return createPortal(
    <div className="sbx-page fade-in">
      <div className="sbx-page-bar">
        <button className="btn btn-ghost" onClick={onClose}>‹ Back</button>
        <div className="sbx-page-title">Watch Stats</div>
        {y.total > 0 && (
          <button
            className="btn btn-ghost"
            disabled={sharing}
            onClick={async () => {
              setSharing(true);
              try {
                await shareStatsCard({
                  year,
                  totalSecs: y.total,
                  titles: yearTitles.length,
                  movies: movies.length,
                  shows: shows.length,
                  bestStreak: y.bestStreak,
                  busiestMonth: y.total ? MONTHS[busiest] : "",
                  top,
                  genres: topGenres,
                });
              } finally {
                setSharing(false);
              }
            }}
          >
            {sharing ? "…" : window.electron?.shareImage ? "Share" : "Save image"}
          </button>
        )}
      </div>
      <div className="sbx-page-body">
        {years.length > 1 && (
          <div className="sbx-chips">
            {years.map((yr) => (
              <button key={yr} className={`sbx-chip${yr === year ? " on" : ""}`} onClick={() => setYear(yr)}>{yr}</button>
            ))}
          </div>
        )}

        <div className="sbx-recap">
          <div className="sbx-recap-kicker">Your {year} in Streambert</div>
          <div className="sbx-recap-big">{fmtHours(y.total)}</div>
          <div className="sbx-recap-sub">
            watched across {yearTitles.length} title{yearTitles.length === 1 ? "" : "s"}
            {movies.length || shows.length ? ` · ${movies.length} movie${movies.length === 1 ? "" : "s"}, ${shows.length} show${shows.length === 1 ? "" : "s"}` : ""}
          </div>
          {top && (
            <button className="sbx-recap-top" onClick={() => onSelect(top)}>
              {top.poster_path && <img src={imgUrl(top.poster_path, "w154")} alt="" />}
              <div>
                <div className="sbx-muted">Most watched</div>
                <div className="sbx-recap-title">{top.title}</div>
                <div className="sbx-muted">{fmtHours(top.secs)}</div>
              </div>
            </button>
          )}
          <div className="sbx-stat-row sbx-recap-row">
            <div><div className="sbx-big">{y.bestStreak}</div><div className="sbx-muted">longest streak (days)</div></div>
            <div><div className="sbx-big">{fmtHours(y.best)}</div><div className="sbx-muted">biggest day</div></div>
            <div><div className="sbx-big">{y.total ? MONTHS[busiest] : "–"}</div><div className="sbx-muted">busiest month</div></div>
          </div>
        </div>

        <div className="library-section-title" style={{ marginTop: 28 }}>By month</div>
        <div className="sbx-bars sbx-bars-tall">
          {y.months.map((s, i) => (
            <div key={i} className="sbx-bar-col">
              <div className="sbx-bar" style={{ height: `${Math.max(3, (s / monthMax) * 100)}%`, opacity: s ? 1 : 0.25 }} />
              <div className="sbx-bar-label">{MONTHS[i][0]}</div>
            </div>
          ))}
        </div>

        {topGenres.length > 0 && (
          <>
            <div className="library-section-title" style={{ marginTop: 28 }}>Top genres</div>
            <div className="sbx-genres">
              {topGenres.map(([g, s]) => (
                <div key={g} className="sbx-genre">
                  <div className="sbx-genre-name">{g}</div>
                  <div className="sbx-genre-bar"><div style={{ width: `${(s / topGenres[0][1]) * 100}%` }} /></div>
                  <div className="sbx-muted">{fmtHours(s)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {yearTitles.length > 0 && (
          <>
            <div className="library-section-title" style={{ marginTop: 28 }}>Top titles</div>
            <div className="history-rows">
              {yearTitles.slice(0, 10).map((t, i) => (
                <div key={`${t.media_type}_${t.id}`} className="history-row" onClick={() => onSelect(t)}>
                  <div className="sbx-rank">{i + 1}</div>
                  <div className="history-thumb">{t.poster_path && <img src={imgUrl(t.poster_path, "w92")} alt="" />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>{t.media_type === "tv" ? "Series" : "Movie"} · {fmtHours(t.secs)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="sbx-muted" style={{ marginTop: 28, marginBottom: 40 }}>
          All time: {fmtHours(all.total)} · longest streak {all.bestStreak} day{all.bestStreak === 1 ? "" : "s"}. Time from all your synced devices is included.
        </div>
      </div>
    </div>,
    document.body,
  );
}
