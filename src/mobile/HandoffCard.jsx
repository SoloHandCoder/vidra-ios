// "Continue on this device?" card (see handoff.js).
import { useEffect, useState } from "react";
import { storage } from "../utils/storage";
import { dismissHandoff, fmtTime, handoffCandidate } from "./handoff.js";
import "./handoff.css";

export function HandoffCard() {
  const [lp, setLp] = useState(null);
  useEffect(() => {
    const check = () => {
      if (window.__sbPlayerState?.()?.playing) return; // already watching something here
      setLp(handoffCandidate());
    };
    const t = setTimeout(check, 6000);
    const iv = setInterval(check, 60000);
    const vis = () => !document.hidden && setTimeout(check, 2500);
    window.addEventListener("streambert:sync-applied", check);
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
      window.removeEventListener("streambert:sync-applied", check);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  if (!lp) return null;
  const ep = lp.media_type === "tv" && lp.season != null ? `S${lp.season} · E${lp.episode}` : null;
  const go = () => {
    dismissHandoff(lp);
    // resume exactly where the other device was
    const key = lp.media_type === "tv" ? `tv_${lp.id}_s${lp.season}e${lp.episode}` : `movie_${lp.id}`;
    storage.set("dlTime_" + key, lp.t);
    window.__sbNav?.open?.({
      id: lp.id,
      media_type: lp.media_type,
      title: lp.title,
      name: lp.title,
      poster_path: lp.poster_path,
      season: lp.season,
      episode: lp.episode,
      partyPlay: lp.media_type === "tv", // start the episode right away
    });
    setLp(null);
  };
  return (
    <div className="sbho" role="dialog" aria-label="Continue watching">
      {lp.poster_path ? <img src={`https://image.tmdb.org/t/p/w154${lp.poster_path}`} alt="" /> : <div className="sbho-ph">▶</div>}
      <div className="sbho-body">
        <div className="sbho-kicker">
          <span>Continue from your</span> <span data-no-i18n>{lp.deviceName}</span>
        </div>
        <div className="sbho-title" data-no-i18n>
          {lp.title}
          {ep ? ` · ${ep}` : ""}
        </div>
        <div className="sbho-at">
          <span>at</span> <span data-no-i18n>{fmtTime(lp.t)}</span>
        </div>
        <div className="sbho-btns">
          <button className="btn btn-primary btn--sm" onClick={go}>▶ Continue here</button>
          <button
            className="btn btn-ghost btn--sm"
            onClick={() => {
              dismissHandoff(lp);
              setLp(null);
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
