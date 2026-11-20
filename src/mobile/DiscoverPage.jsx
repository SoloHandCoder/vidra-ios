// Discover: collections, genres and filters (TMDB /discover). Shared by the
// Android app and the desktop app.
import { useEffect, useMemo, useRef, useState } from "react";
import MediaCard from "../components/MediaCard";
import { tmdbFetch } from "../utils/api";
import "./discover.css";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// TMDB genre ids (movie | tv)
const G = { action: [28, 10759], adventure: [12, 10759], animation: [16, 16], comedy: [35, 35], crime: [80, 80], documentary: [99, 99], drama: [18, 18], family: [10751, 10751], fantasy: [14, 10765], horror: [27, 9648], mystery: [9648, 9648], romance: [10749, 10766], scifi: [878, 10765], thriller: [53, 9648], war: [10752, 10768], western: [37, 37] };

export const COLLECTIONS = [
  { id: "new", emoji: "🆕", title: "New this month", type: "movie", q: () => ({ "primary_release_date.gte": daysAgo(35), "primary_release_date.lte": today(), sort_by: "popularity.desc" }) },
  { id: "soon", emoji: "📅", title: "Coming soon", type: "movie", q: () => ({ "primary_release_date.gte": daysAhead(1), "primary_release_date.lte": daysAhead(90), sort_by: "popularity.desc" }) },
  { id: "horror", emoji: "👻", title: "Top horror", type: "movie", q: () => ({ with_genres: "27", "vote_count.gte": 800, sort_by: "vote_average.desc" }) },
  { id: "80s", emoji: "🕹️", title: "80s action", type: "movie", q: () => ({ with_genres: "28", "primary_release_date.gte": "1980-01-01", "primary_release_date.lte": "1989-12-31", "vote_count.gte": 300, sort_by: "popularity.desc" }) },
  { id: "feelgood", emoji: "😄", title: "Feel-good comedies", type: "movie", q: () => ({ with_genres: "35", without_genres: "27,53,80", "vote_average.gte": 7, "vote_count.gte": 500, sort_by: "popularity.desc" }) },
  { id: "mind", emoji: "🌀", title: "Mind-bending sci-fi", type: "movie", q: () => ({ with_genres: "878", "vote_average.gte": 7.2, "vote_count.gte": 1000, sort_by: "vote_average.desc" }) },
  { id: "animated", emoji: "🎨", title: "Animated for everyone", type: "movie", q: () => ({ with_genres: "16", "vote_average.gte": 7, "vote_count.gte": 800, sort_by: "popularity.desc" }) },
  { id: "gems", emoji: "💎", title: "Hidden gems", type: "movie", q: () => ({ "vote_average.gte": 7.5, "vote_count.gte": 150, "vote_count.lte": 1200, sort_by: "vote_average.desc" }) },
  { id: "kdrama", emoji: "🇰🇷", title: "Korean dramas", type: "tv", q: () => ({ with_original_language: "ko", with_genres: "18", sort_by: "popularity.desc" }) },
  { id: "anime", emoji: "⛩️", title: "Anime series", type: "tv", q: () => ({ with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc" }) },
  { id: "crime", emoji: "🕵️", title: "True crime documentaries", type: "tv", q: () => ({ with_genres: "99,80", sort_by: "popularity.desc" }) },
  { id: "binge", emoji: "🍿", title: "Bingeable series", type: "tv", q: () => ({ "vote_average.gte": 8, "vote_count.gte": 800, sort_by: "popularity.desc" }) },
];

const GENRES = [
  ["action", "Action"], ["adventure", "Adventure"], ["animation", "Animation"], ["comedy", "Comedy"], ["crime", "Crime"],
  ["documentary", "Documentary"], ["drama", "Drama"], ["family", "Family"], ["fantasy", "Fantasy"], ["horror", "Horror"],
  ["mystery", "Mystery"], ["romance", "Romance"], ["scifi", "Sci-Fi"], ["thriller", "Thriller"], ["war", "War"], ["western", "Western"],
];
const DECADES = [["", "Any year"], ["2020", "2020s"], ["2010", "2010s"], ["2000", "2000s"], ["1990", "90s"], ["1980", "80s"], ["1970", "70s"], ["old", "Older"]];
const RATINGS = [["", "Any rating"], ["6", "6+"], ["7", "7+"], ["8", "8+"]];
const LENGTHS = [["", "Any length"], ["short", "Under 90 min"], ["mid", "90–120 min"], ["long", "Over 2 h"]];
const LANGS = [["", "Any language"], ["en", "English"], ["de", "German"], ["es", "Spanish"], ["fr", "French"], ["it", "Italian"], ["pt", "Portuguese"], ["ja", "Japanese"], ["ko", "Korean"], ["hi", "Hindi"], ["zh", "Chinese"], ["tr", "Turkish"], ["sv", "Swedish"]];
const SORTS = [["popularity.desc", "Popular"], ["vote_average.desc", "Top rated"], ["date.desc", "Newest"]];

function filterQuery(type, f) {
  const q = { sort_by: f.sort, "vote_count.gte": f.sort === "vote_average.desc" ? 300 : 20 };
  const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
  if (f.sort === "date.desc") {
    q.sort_by = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
    q[`${dateKey}.lte`] = today();
  }
  if (f.genres.length) q.with_genres = f.genres.map((g) => G[g][type === "movie" ? 0 : 1]).join(",");
  if (f.decade === "old") q[`${dateKey}.lte`] = "1969-12-31";
  else if (f.decade) {
    q[`${dateKey}.gte`] = `${f.decade}-01-01`;
    q[`${dateKey}.lte`] = `${Number(f.decade) + 9}-12-31`;
  }
  if (f.rating) q["vote_average.gte"] = f.rating;
  if (type === "movie") {
    if (f.length === "short") q["with_runtime.lte"] = 89;
    if (f.length === "mid") Object.assign(q, { "with_runtime.gte": 90, "with_runtime.lte": 120 });
    if (f.length === "long") q["with_runtime.gte"] = 121;
  }
  if (f.lang) q.with_original_language = f.lang;
  return q;
}

async function fetchDiscover(apiKey, type, q, page) {
  const p = new URLSearchParams({ include_adult: "false", page: String(page), ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) });
  const d = await tmdbFetch(`/discover/${type}?${p}`, apiKey);
  return { items: (d?.results || []).filter((i) => i.poster_path).map((i) => ({ ...i, media_type: type })), pages: d?.total_pages || 1 };
}

function Chips({ list, value, onPick, multi }) {
  return (
    <div className="sbd-chips">
      {list.map(([v, label]) => {
        const on = multi ? value.includes(v) : value === v;
        return (
          <button key={v || "any"} type="button" className={`sbx-chip${on ? " on" : ""}`} onClick={() => onPick(v)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Results({ apiKey, type, query, onSelect, watched, onMarkWatched, onMarkUnwatched, sig }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const run = useRef(0);
  const load = async (pg, reset) => {
    const my = ++run.current;
    setLoading(true);
    setError(false);
    try {
      const r = await fetchDiscover(apiKey, type, query, pg);
      if (my !== run.current) return;
      setItems((prev) => {
        const all = reset ? r.items : [...prev, ...r.items];
        const seen = new Set();
        return all.filter((i) => !seen.has(i.id) && seen.add(i.id));
      });
      setPages(r.pages);
      setPage(pg);
    } catch {
      if (my === run.current) setError(true);
    } finally {
      if (my === run.current) setLoading(false);
    }
  };
  useEffect(() => {
    setItems([]);
    load(1, true);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {items.length > 0 && (
        <div className="cards-grid">
          {items.map((it) => (
            <MediaCard key={`${type}_${it.id}`} item={it} onClick={() => onSelect(it)} watched={watched} onMarkWatched={onMarkWatched} onMarkUnwatched={onMarkUnwatched} />
          ))}
        </div>
      )}
      {!loading && !error && items.length === 0 && <div className="sbx-muted sbd-empty">Nothing matches these filters. Try fewer filters.</div>}
      {error && <div className="sbx-muted sbd-empty">Couldn't load titles. Check your connection and try again.</div>}
      {loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}
      {!loading && items.length > 0 && page < pages && page < 25 && (
        <div className="sbd-more">
          <button className="btn btn-secondary" onClick={() => load(page + 1)}>Load more</button>
        </div>
      )}
    </>
  );
}

export default function DiscoverPage({ apiKey, onSelect, watched, onMarkWatched, onMarkUnwatched }) {
  const [collection, setCollection] = useState(null);
  const [type, setType] = useState("movie");
  const [f, setF] = useState({ genres: [], decade: "", rating: "", length: "", lang: "", sort: "popularity.desc" });
  const [showFilters, setShowFilters] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const toggleGenre = (g) => setF((x) => ({ ...x, genres: x.genres.includes(g) ? x.genres.filter((y) => y !== g) : [...x.genres, g] }));
  const col = COLLECTIONS.find((c) => c.id === collection);
  const query = useMemo(() => (col ? col.q() : filterQuery(type, f)), [col, type, f]);
  const sig = JSON.stringify([collection, type, f]);
  const active = f.genres.length + [f.decade, f.rating, f.length, f.lang].filter(Boolean).length;

  if (!apiKey) {
    return (
      <div className="fade-in sbd-page">
        <div className="library-header"><div className="library-title">Discover</div></div>
        <div className="library-section sbx-muted">Add your TMDB token in Settings to discover movies and series.</div>
      </div>
    );
  }

  return (
    <div className="fade-in sbd-page">
      <div className="library-header">
        <div className="library-title">Discover</div>
        <div className="library-sub">Collections, genres and filters</div>
      </div>

      <div className="library-section sbd-body">
      <div className="sbd-collections">
        {COLLECTIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`sbd-col${collection === c.id ? " on" : ""}`}
            onClick={() => setCollection(collection === c.id ? null : c.id)}
          >
            <span className="sbd-col-emoji" aria-hidden="true">{c.emoji}</span>
            <span className="sbd-col-title">{c.title}</span>
          </button>
        ))}
      </div>

      {col ? (
        <div className="sbd-bar">
          <div className="section-title" style={{ margin: 0 }}>{col.title}</div>
          <button className="sbx-link" onClick={() => setCollection(null)}>✕ Clear</button>
        </div>
      ) : (
        <>
          <div className="sbd-bar">
            <div className="sbd-seg" role="tablist">
              {[["movie", "Movies"], ["tv", "Series"]].map(([v, l]) => (
                <button key={v} role="tab" aria-selected={type === v} className={type === v ? "on" : ""} onClick={() => setType(v)}>{l}</button>
              ))}
            </div>
            <select className="sbd-select" value={f.sort} onChange={(e) => set("sort")(e.target.value)} aria-label="Sort by">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className={`btn btn-ghost btn--sm sbd-filter-btn${active ? " on" : ""}`} onClick={() => setShowFilters((v) => !v)}>
              Filters{active ? ` (${active})` : ""}
            </button>
          </div>
          <Chips list={GENRES} value={f.genres} onPick={toggleGenre} multi />
          {showFilters && (
            <div className="sbd-filters">
              <div className="sbd-filter-label">Year</div>
              <Chips list={DECADES} value={f.decade} onPick={set("decade")} />
              <div className="sbd-filter-label">Rating</div>
              <Chips list={RATINGS} value={f.rating} onPick={set("rating")} />
              {type === "movie" && (
                <>
                  <div className="sbd-filter-label">Length</div>
                  <Chips list={LENGTHS} value={f.length} onPick={set("length")} />
                </>
              )}
              <div className="sbd-filter-label">Original language</div>
              <Chips list={LANGS} value={f.lang} onPick={set("lang")} />
              {active > 0 && (
                <button className="btn btn-ghost btn--sm" style={{ marginTop: 10 }} onClick={() => setF((x) => ({ ...x, genres: [], decade: "", rating: "", length: "", lang: "" }))}>
                  Reset filters
                </button>
              )}
            </div>
          )}
        </>
      )}

      <Results
        key={sig}
        sig={sig}
        apiKey={apiKey}
        type={col ? col.type : type}
        query={query}
        onSelect={onSelect}
        watched={watched}
        onMarkWatched={onMarkWatched}
        onMarkUnwatched={onMarkUnwatched}
      />
      </div>
    </div>
  );
}
