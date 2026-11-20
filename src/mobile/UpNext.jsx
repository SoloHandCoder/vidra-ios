// "Up next" card shown over the player when the credits start: a small card in
// the corner (the credits stay visible) that plays the next episode after a
// countdown. "Watch credits" keeps watching instead.
import "./upnext.css";

export function UpNextCard({ countdown, total, kicker, title, subtitle, image, layout, onPlay, onDismiss }) {
  const pct = total > 0 && countdown > 0 ? Math.max(0, Math.min(1, countdown / total)) : 0;
  return (
    <div className={`sbun${layout === "left" ? " left" : ""}`} role="dialog" aria-label="Up next">
      <div className="sbun-card">
        <div className="sbun-thumb">
          {image ? <img src={image} alt="" /> : <span className="sbun-ph">▶</span>}
          {countdown > 0 && (
            <span className="sbun-ring" aria-hidden="true">
              <svg viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" className="sbun-ring-bg" />
                <circle cx="18" cy="18" r="15.5" className="sbun-ring-fg" style={{ strokeDashoffset: `${(1 - pct) * 97.4}` }} />
              </svg>
              <b>{countdown}</b>
            </span>
          )}
        </div>
        <div className="sbun-body">
          <div className="sbun-kicker">{kicker || "Up next"}</div>
          {subtitle && <div className="sbun-sub" data-no-i18n>{subtitle}</div>}
          <div className="sbun-title" data-no-i18n>{title}</div>
          <div className="sbun-btns">
            <button className="btn btn-primary btn--sm" onClick={onPlay}>
              {countdown > 0 ? "Play now" : "Play next"}
            </button>
            <button className="btn btn-ghost btn--sm" onClick={onDismiss}>
              Watch credits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
