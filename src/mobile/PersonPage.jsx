// Actor / director page: photo, bio, filmography, follow.
import { useEffect, useMemo, useState } from "react";
import MediaCard from "../components/MediaCard";
import { imgUrl, tmdbFetch } from "../utils/api";
import { toggleFollow, usePeople } from "./people.js";
import "./discover.css";
import "./discovery.css";

const yearOf = (c) => (c.release_date || c.first_air_date || "").slice(0, 4);

export default function PersonPage({ person, apiKey, onSelect, onBack, watched, onMarkWatched, onMarkUnwatched }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [tab, setTab] = useState(null);
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("popular");
  const [bioOpen, setBioOpen] = useState(false);
  const { followed } = usePeople();
  const following = !!followed[person?.id];

  useEffect(() => {
    if (!person?.id || !apiKey) return;
    let alive = true;
    setData(null);
    setErr(false);
    tmdbFetch(`/person/${person.id}?append_to_response=combined_credits`, apiKey)
      .then((d) => alive && setData(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [person?.id, apiKey]);

  const credits = data?.combined_credits;
  // tabs: Acting + each crew department the person has
  const tabs = useMemo(() => {
    if (!credits) return [];
    const t = [];
    if (credits.cast?.length) t.push(["Acting", credits.cast]);
    const byDept = {};
    for (const c of credits.crew || []) (byDept[c.department] = byDept[c.department] || []).push(c);
    for (const [d, list] of Object.entries(byDept).sort((a, b) => b[1].length - a[1].length)) t.push([d, list]);
    return t;
  }, [credits]);
  const current = tab || (data?.known_for_department === "Acting" ? "Acting" : tabs.find(([d]) => d === data?.known_for_department)?.[0]) || tabs[0]?.[0];
  const list = useMemo(() => {
    const raw = tabs.find(([d]) => d === current)?.[1] || [];
    const seen = new Map();
    for (const c of raw) {
      if (!c.poster_path || (kind !== "all" && c.media_type !== kind)) continue;
      if ((c.genre_ids || []).some((g) => g === 10767 || g === 10763)) continue; // talk shows, news
      const k = `${c.media_type}_${c.id}`;
      const prev = seen.get(k);
      const role = c.character || c.job || "";
      if (prev) prev._role = [prev._role, role].filter(Boolean).join(", ");
      else seen.set(k, { ...c, _role: role });
    }
    const arr = [...seen.values()];
    if (sort === "new") arr.sort((a, b) => (yearOf(b) || "0").localeCompare(yearOf(a) || "0"));
    else if (sort === "rating") arr.sort((a, b) => (b.vote_count > 50 ? b.vote_average : 0) - (a.vote_count > 50 ? a.vote_average : 0));
    else arr.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return arr;
  }, [tabs, current, kind, sort]);

  if (!person) return null;
  const p = data || person;
  const born = data?.birthday ? new Date(data.birthday + "T12:00:00") : null;
  const died = data?.deathday ? new Date(data.deathday + "T12:00:00") : null;
  const age = born ? Math.floor(((died || new Date()) - born) / (365.25 * 86400000)) : null;
  const loc = document.documentElement.lang || undefined;

  return (
    <div className="fade-in sbd-page library-section sbp-page">
      <div className="sbp-head">
        {p.profile_path ? (
          <img className="sbp-photo" src={imgUrl(p.profile_path, "h632")} alt="" />
        ) : (
          <div className="sbp-photo sbp-photo--empty">{(p.name || "?")[0]}</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sbp-name" data-no-i18n>{p.name}</div>
          <div className="sbp-meta">
            {data?.known_for_department && <span>{data.known_for_department}</span>}
            {born && (
              <span>
                {born.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" })}
                {died ? ` – ${died.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" })}` : ""}
                {age != null ? ` (${age})` : ""}
              </span>
            )}
            {data?.place_of_birth && <span data-no-i18n>{data.place_of_birth}</span>}
          </div>
          <div className="sbp-actions">
            <button
              className={`btn ${following ? "btn-secondary sbp-following" : "btn-primary"}`}
              disabled={!credits}
              onClick={() => toggleFollow(p, credits)}
            >
              {following ? "✓ Following" : "+ Follow"}
            </button>
            {onBack && <button className="btn btn-ghost" onClick={onBack}>‹ Back</button>}
          </div>
          {following && <div className="sbx-muted" style={{ marginTop: 6 }}>You'll be told when {p.name} is in something new.</div>}
          {data?.biography && (
            <>
              <div className={`sbp-bio${bioOpen ? "" : " clamp"}`} data-no-i18n style={{ marginTop: 14 }}>{data.biography}</div>
              {data.biography.length > 420 && (
                <button className="sbx-link" onClick={() => setBioOpen((v) => !v)}>{bioOpen ? "Show less" : "Read more"}</button>
              )}
            </>
          )}
        </div>
      </div>

      {err && <div className="sbx-muted">Couldn't load this person. Check your connection.</div>}
      {!data && !err && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}

      {tabs.length > 0 && (
        <>
          <div className="sbd-chips sbp-tabs">
            {tabs.map(([d, l]) => (
              <button key={d} className={`sbx-chip${current === d ? " on" : ""}`} onClick={() => setTab(d)}>
                {d} <span className="sbx-muted" style={{ marginLeft: 4 }}>{new Set(l.map((c) => c.id)).size}</span>
              </button>
            ))}
          </div>
          <div className="sbd-bar">
            <div className="sbd-seg">
              {[["all", "All"], ["movie", "Movies"], ["tv", "Series"]].map(([v, l]) => (
                <button key={v} className={kind === v ? "on" : ""} onClick={() => setKind(v)}>{l}</button>
              ))}
            </div>
            <select className="sbd-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
              <option value="popular">Popular</option>
              <option value="new">Newest</option>
              <option value="rating">Top rated</option>
            </select>
          </div>
          <div className="cards-grid">
            {list.map((c) => (
              <MediaCard
                key={`${c.media_type}_${c.id}`}
                item={c}
                onClick={() => onSelect(c)}
                watched={watched}
                onMarkWatched={onMarkWatched}
                onMarkUnwatched={onMarkUnwatched}
              />
            ))}
          </div>
          {list.length === 0 && <div className="sbx-muted sbd-empty">Nothing here.</div>}
        </>
      )}
    </div>
  );
}

/** Home row: new titles from people you follow */
export function PeopleNewsRow({ onSelect }) {
  const { news, followed } = usePeople();
  const items = news.filter((n) => followed[n.person.id]).slice(0, 15);
  if (!items.length) return null;
  return (
    <div className="section sbu-section">
      <div className="section-title">New from people you follow</div>
      <div className="sbu-row">
        {items.map((n) => (
          <button key={`${n.item.media_type}_${n.item.id}`} className="sbu-card" onClick={() => onSelect(n.item)} title={n.item.title}>
            <div className="sbu-poster">
              {n.item.poster_path && <img src={imgUrl(n.item.poster_path, "w342")} alt="" loading="lazy" />}
              <span className="sbu-badge" data-no-i18n>{n.person.name}</span>
            </div>
            <div className="sbu-name">{n.item.title}</div>
            <div className="sbu-sub">{(n.item.release_date || "").slice(0, 4) || (n.item.media_type === "tv" ? "Series" : "Movie")}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
