import MobileWebView from "../mobile/MobileWebView";
import { useEffect, useRef, useState, useCallback } from "react";
import { CloseIcon, ExternalLinkIcon } from "./Icons";
import { storage } from "../utils/storage";

export const DEFAULT_INVIDIOUS_BASE = "https://inv.nadeko.net";

// Used when the live list below can't be loaded
const FALLBACK_INSTANCES = [
  "https://invidious.nerdvpn.de",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
  "https://invidious.protokolla.fi",
];

// Last resort when no Invidious server works: YouTube's privacy-enhanced player
const YOUTUBE_NOCOOKIE = (key) =>
  `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;

// Live list of healthy Invidious servers (cached for 6 h)
let _liveCache = null;
async function liveInstances() {
  if (_liveCache && Date.now() - _liveCache.at < 6 * 3600 * 1000) return _liveCache.list;
  try {
    const res = await fetch("https://api.invidious.io/instances.json?sort_by=health", {
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    const list = data
      .filter(([, i]) => i?.type === "https" && (i.monitor?.uptime ?? 0) >= 90 && i.uri)
      .slice(0, 5)
      .map(([, i]) => i.uri.replace(/\/$/, ""));
    if (list.length) {
      _liveCache = { at: Date.now(), list };
      return list;
    }
  } catch {}
  return FALLBACK_INSTANCES;
}

export function getInvidiousBase() {
  return (storage.get("invidiousBase") || DEFAULT_INVIDIOUS_BASE).replace(
    /\/$/,
    "",
  );
}

const DETECT_BOT_JS = `
(function() {
  var title = (document.title || '').toLowerCase()
  var body  = (document.body  && document.body.innerText || '').toLowerCase()
  var botKeywords = ['verifying', 'antibot', 'challenge', 'ddos', 'please wait', 'checking your browser', 'just a moment']
  var isBot = botKeywords.some(function(k) { return title.includes(k) || body.includes(k) })
  // dead server → browser error page ("Webpage not available") or no player at all
  var isError = location.protocol === 'chrome-error:' || title.includes('not available') ||
    body.includes('err_') || body.includes('502 bad gateway') || body.includes('503 service')
  return { isBot: isBot || isError, hasVideo: !!document.querySelector('video') }
})()
`;

// Hide the built-in Invidious button, detect video end
const SETUP_JS = `
(function() {
  if (window.__trailerSetup) return
  window.__trailerSetup = true

  // Hide the "Watch on Invidious" button inside the player
  var style = document.createElement('style')
  style.textContent = '.player-container .invidious-link, a[href*="/watch"], .vjs-invidious-button { display: none !important; }'
  document.head.appendChild(style)

  // Detect video end and notify host
  var attachEnded = function() {
    var video = document.querySelector('video')
    if (!video) return false
    video.addEventListener('ended', function() {
      window.__trailerEnded = true
    })
    return true
  }
  if (!attachEnded()) {
    var obs = new MutationObserver(function() { if (attachEnded()) obs.disconnect() })
    obs.observe(document.body, { childList: true, subtree: true })
  }
})()
`;

export default function TrailerModal({ trailerKey, title, onClose }) {
  const webviewRef = useRef(null);
  const [currentSrc, setCurrentSrc] = useState(null);
  const [statusMsg, setStatusMsg] = useState("Loading trailer…");
  const [failed, setFailed] = useState(false);
  const instanceIndexRef = useRef(-1);

  const listRef = useRef(null);
  const tryNextInstance = useCallback(async () => {
    if (!listRef.current) {
      const preferred = getInvidiousBase();
      const live = await liveInstances();
      listRef.current = [preferred, ...live.filter((i) => i !== preferred), "youtube"];
    }
    const list = listRef.current;
    instanceIndexRef.current += 1;
    const idx = instanceIndexRef.current;
    if (idx >= list.length) {
      setFailed(true);
      setStatusMsg("Couldn't load the trailer. Try “Open in Browser”.");
      return;
    }
    const instance = list[idx];
    if (instance === "youtube") {
      setStatusMsg(idx === 0 ? "Loading trailer…" : "Trying YouTube…");
      setCurrentSrc(YOUTUBE_NOCOOKIE(trailerKey));
      return;
    }
    const label = instance.replace(/^https?:\/\//, "");
    setStatusMsg(idx === 0 ? "Loading trailer…" : `Trying ${label}…`);
    setCurrentSrc(`${instance}/embed/${trailerKey}?autoplay=1&listen=0`);
  }, [trailerKey]);

  useEffect(() => {
    instanceIndexRef.current = -1;
    listRef.current = null;
    tryNextInstance();
  }, [tryNextInstance]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Open current video on Invidious in system browser
  const openInBrowser = () => {
    const preferred = getInvidiousBase();
    const url = `${preferred}/watch?v=${trailerKey}`;
    window.electron?.openExternal(url);
  };

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !currentSrc) return;

    const isYouTube = currentSrc.includes("youtube-nocookie.com");
    let settled = false;
    // a server that never finishes loading → try the next one
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        tryNextInstance();
      }
    }, isYouTube ? 15000 : 9000);
    const onLoad = async () => {
      if (settled) return;
      if (isYouTube) {
        settled = true;
        clearTimeout(timeout);
        setStatusMsg(null);
        return;
      }
      // the player may appear a moment after load
      for (let i = 0; i < 4 && !settled; i++) {
        let r = null;
        try {
          r = await wv.executeJavaScript(DETECT_BOT_JS);
        } catch {}
        if (r && r.isBot) break;
        if (r && r.hasVideo) {
          settled = true;
          clearTimeout(timeout);
          wv.executeJavaScript(SETUP_JS).catch(() => {});
          setStatusMsg(null);
          return;
        }
        await new Promise((res) => setTimeout(res, 1200));
      }
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        tryNextInstance();
      }
    };

    const onFailLoad = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      tryNextInstance();
    };

    const onWillNavigate = (e) => {
      const instanceBase = currentSrc.split("/embed/")[0];
      if (!e.url.startsWith(instanceBase)) {
        e.preventDefault();
        window.electron?.openExternal(e.url);
      }
    };

    const endedPoll = setInterval(() => {
      wv.executeJavaScript("!!window.__trailerEnded")
        .then((ended) => {
          if (ended) {
            clearInterval(endedPoll);
            setTimeout(onClose, 1200);
          }
        })
        .catch(() => {});
    }, 800);

    wv.addEventListener("did-finish-load", onLoad);
    wv.addEventListener("did-fail-load", onFailLoad);
    wv.addEventListener("will-navigate", onWillNavigate);
    return () => {
      settled = true;
      clearTimeout(timeout);
      clearInterval(endedPoll);
      wv.removeEventListener("did-finish-load", onLoad);
      wv.removeEventListener("did-fail-load", onFailLoad);
      wv.removeEventListener("will-navigate", onWillNavigate);
    };
  }, [currentSrc, tryNextInstance, onClose]);

  return (
    <div className="trailer-overlay" onClick={onClose}>
      <div className="trailer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trailer-modal-header">
          <span className="trailer-modal-title">
            🎬 {title} — Official Trailer
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={openInBrowser}
              title="Open in browser"
              className="trailer-openbrowser-btn"
            >
              <ExternalLinkIcon size={13} />
              Open in Browser
            </button>
            <button
              className="trailer-close-btn"
              onClick={onClose}
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div
          className="trailer-embed-wrap"
          style={{ background: "#000", position: "relative" }}
        >
          {(statusMsg || failed) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                color: failed ? "#ff3860" : "rgba(255,255,255,0.6)",
                fontSize: 14,
                textAlign: "center",
                padding: "0 32px",
                gap: 10,
              }}
            >
              {failed ? (
                <>
                  <span style={{ fontSize: 28 }}>⚠</span>
                  <span>{statusMsg}</span>
                </>
              ) : (
                <>
                  <span style={{ opacity: 0.5 }}>⏳</span>
                  <span>{statusMsg}</span>
                </>
              )}
            </div>
          )}

          {currentSrc && (
            <MobileWebView
              ref={webviewRef}
              src={currentSrc}
              partition="persist:trailer"
              allowpopups="false"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
                opacity: statusMsg ? 0 : 1,
                transition: "opacity 0.2s",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
