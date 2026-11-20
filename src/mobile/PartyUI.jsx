// Watch party UI: a button on movie / show pages, the party panel (start / join,
// people, host controls, ready check, queue, chat, reactions), pop-ups while the
// panel is closed, and floating reactions / the start countdown over everything.
import { useEffect, useRef, useState } from "react";
import {
  addToQueue,
  cancelReadyCheck,
  codeFromLink,
  getParty,
  inviteLink,
  joinParty,
  leaveParty,
  markReady,
  moveInQueue,
  onParty,
  playFromQueue,
  removeFromQueue,
  sameMedia,
  sendChat,
  sendReaction,
  setControl,
  startReadyCheck,
  startTogether,
} from "./party.js";
import "./party.css";

const EMOJI = ["😂", "😮", "😍", "👏", "😢", "🔥"];
const openPanel = () => window.dispatchEvent(new Event("streambert:party-open"));

function profileName() {
  try {
    const m = JSON.parse(localStorage.getItem("__sb_profiles") || "null");
    const p = m?.list?.find((x) => x.id === m.current);
    return localStorage.getItem("__sb_party_name") || p?.name || "Me";
  } catch {
    return "Me";
  }
}

function useParty() {
  const [p, setP] = useState(getParty);
  useEffect(() => onParty(setP), []);
  return p;
}

function PartyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.2c2.6.2 4.4 1.8 5 4.8" />
    </svg>
  );
}

/** what's open right now, as a queue item */
function currentItem() {
  const nav = window.__sbNav;
  const pg = nav?.page?.();
  const sel = nav?.selected?.();
  if (!sel?.id || (pg !== "movie" && pg !== "tv")) return null;
  const w = pg === "tv" ? nav?.watching?.() : null;
  return { id: sel.id, media_type: pg, title: sel.title || sel.name || "", poster_path: sel.poster_path, season: w?.season ?? null, episode: w?.episode ?? null };
}

/** button for the movie / show page */
export function PartyButton() {
  const p = useParty();
  const [added, setAdded] = useState(false);
  return (
    <>
      <button className={`btn btn-secondary${p ? " sbpt-active" : ""}`} onClick={openPanel}>
        <PartyIcon />
        {p ? `Party · ${p.members.length}` : "Watch party"}
      </button>
      {p && (
        <button
          className="btn btn-secondary"
          disabled={added}
          onClick={() => {
            const it = currentItem();
            if (it && addToQueue(it)) {
              setAdded(true);
              setTimeout(() => setAdded(false), 2000);
            }
          }}
        >
          {added ? "✓ Added" : p.isHost ? "＋ Party queue" : "＋ Suggest"}
        </button>
      )}
    </>
  );
}

const mediaLabel = (m) => (m ? `${m.title || ""}${m.media_type === "tv" && m.season != null ? ` S${m.season}E${m.episode}` : ""}` : "");

async function shareInvite(code) {
  const link = inviteLink(code);
  const text = `Join my Vidra watch party! ${link}\nOr open Vidra → Watch party → Join and enter ${code}`;
  if (window.electron?.shareText) {
    try {
      await window.electron.shareText({ text });
      return "shared";
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "";
  }
}

/** mounted once by the app */
export function PartyDock() {
  const p = useParty();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profileName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState("");
  const [tab, setTab] = useState("chat");
  const chatRef = useRef(null);
  const [pops, setPops] = useState([]);
  const [readyPop, setReadyPop] = useState(null);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const h = (e) => {
      if (openRef.current) return; // the chat is open anyway
      const id = Math.random();
      setPops((a) => [...a.slice(-2), { id, ...e.detail }]);
      setTimeout(() => setPops((a) => a.filter((x) => x.id !== id)), 4500);
    };
    const r = (e) => setReadyPop(e.detail || {});
    window.addEventListener("streambert:party-message", h);
    window.addEventListener("streambert:party-ready-check", r);
    return () => {
      window.removeEventListener("streambert:party-message", h);
      window.removeEventListener("streambert:party-ready-check", r);
    };
  }, []);
  useEffect(() => {
    if (open) setPops([]);
  }, [open]);
  useEffect(() => {
    if (!p?.ready || p.ready.meReady) setReadyPop(null);
  }, [p?.ready, p?.ready?.meReady]);

  const start = async (joinCode, who) => {
    setErr("");
    setBusy(joinCode ? "join" : "start");
    const n = (who ?? name).trim() || "Me";
    try {
      localStorage.setItem("__sb_party_name", n);
      await joinParty(joinCode || null, n);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  };
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    const h = () => setOpen(true);
    // invite link: open the panel and join straight away
    const j = (e) => {
      const c = codeFromLink(e.detail?.link) || e.detail?.code;
      if (!c) return;
      setOpen(true);
      setCode(c);
      if (getParty()?.code === c) return;
      startRef.current(c, profileName());
    };
    window.addEventListener("streambert:party-open", h);
    window.addEventListener("streambert:party-join", j);
    return () => {
      window.removeEventListener("streambert:party-open", h);
      window.removeEventListener("streambert:party-join", j);
    };
  }, []);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: 1e9 });
  }, [p?.chat?.length, open, tab]);
  useEffect(() => {
    if (!open) return;
    const prev = window.__sbSheetBack;
    window.__sbSheetBack = () => (setOpen(false), true);
    return () => (window.__sbSheetBack = prev);
  }, [open]);

  if (!open) {
    if (!p) return null;
    const host = p.members.find((m) => m.id === p.hostId);
    return (
      <>
        {(pops.length > 0 || readyPop) && (
          <div className="sbpt-pops">
            {pops.map((m) => (
              <button key={m.id} className={`sbpt-pop${m.sys ? " sys" : ""}`} onClick={() => setOpen(true)}>
                <span className="sbpt-pop-name" data-no-i18n>
                  {m.host && <span className="sbpt-crown" aria-label="Host">👑</span>}
                  {m.name}
                </span>
                <span className="sbpt-pop-text" data-no-i18n={m.sys ? undefined : true}>{m.text}</span>
              </button>
            ))}
            {readyPop && p.ready && !p.ready.meReady && (
              <div className="sbpt-pop sbpt-pop-ready">
                <span className="sbpt-pop-name" data-no-i18n>👑 {host?.name || readyPop.name}</span>
                <span className="sbpt-pop-text">Ready check: are you ready?</span>
                <button className="btn btn-primary btn--sm" onClick={() => markReady()}>I'm ready</button>
              </div>
            )}
          </div>
        )}
        <button className="sbpt-pill" onClick={() => setOpen(true)} title="Watch party">
          <PartyIcon size={18} />
          <span>{p.members.length}</span>
          {p.isHost && <span className="sbpt-crown" title="You're the host">👑</span>}
          {p.ready && <span className="sbpt-ready-dot" title="Ready check" />}
          {p.status !== "connected" && <span className="sbpt-dot" />}
        </button>
      </>
    );
  }
  const host = p?.members.find((m) => m.id === p.hostId);
  const elsewhere = p?.remoteMedia && !sameMedia(p.remoteMedia, p.media) ? p.remoteMedia : null;
  const readyElsewhere = p?.ready?.media && !sameMedia(p.ready.media, p.media) ? p.ready.media : null;
  const here = currentItem();

  return (
    <div className="sbpt-panel" role="dialog" aria-label="Watch party">
      <div className="sbpt-head">
        <PartyIcon size={18} />
        <div className="sbpt-title">
          Watch party
          {p && (
            <div className="sbpt-hostline">
              {p.isHost ? (
                <span className="sbpt-host-tag">👑 You're the host</span>
              ) : host ? (
                <>
                  <span className="sbpt-hosted">Hosted by</span>{" "}
                  <span className="sbpt-host-tag" data-no-i18n>👑 {host.name}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
        <button className="icon-btn sbpt-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>

      {!p ? (
        <div className="sbpt-body">
          <div className="sbx-muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
            Watch together: play, pause and jumping stay in sync, and you can chat. Everyone needs Vidra and the same
            source. Messages are end-to-end encrypted with the party code.
          </div>
          <label className="sbpt-label">Your name</label>
          <input className="sbx-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary sbpt-wide" disabled={!!busy} onClick={() => start(null)}>
            {busy === "start" ? "Starting…" : "Start a party"}
          </button>
          <div className="sbpt-or">or join one</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="sbx-input"
              placeholder="Party code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && start(code)}
              style={{ letterSpacing: 2, fontWeight: 700 }}
            />
            <button className="btn btn-secondary" disabled={!!busy || !code.trim()} onClick={() => start(code)}>
              {busy === "join" ? "…" : "Join"}
            </button>
          </div>
          {busy === "join" && <div className="sbx-muted" style={{ fontSize: 13 }}>Joining…</div>}
          {err && <div className="sbpt-err">{err}</div>}
        </div>
      ) : (
        <div className="sbpt-body sbpt-live">
          <div className="sbpt-code-row">
            <div>
              <div className="sbx-muted" style={{ fontSize: 12 }}>Party code</div>
              <div className="sbpt-code" data-no-i18n>{p.code}</div>
            </div>
            <button
              className="btn btn-primary btn--sm"
              onClick={async () => {
                const r = await shareInvite(p.code);
                if (r === "copied") {
                  setCopied("invite");
                  setTimeout(() => setCopied(""), 1800);
                }
              }}
            >
              {copied === "invite" ? "✓ Link copied" : "Invite"}
            </button>
            <button
              className="btn btn-ghost btn--sm"
              onClick={() => {
                navigator.clipboard?.writeText(p.code).then(() => {
                  setCopied("code");
                  setTimeout(() => setCopied(""), 1500);
                });
              }}
            >
              {copied === "code" ? "✓ Copied" : "Copy"}
            </button>
            <button className="btn btn-ghost btn--sm" onClick={() => leaveParty()}>Leave</button>
          </div>
          {p.status !== "connected" && <div className="sbpt-err">Reconnecting…</div>}
          <div className="sbpt-members">
            {[...p.members].sort((a, b) => (b.id === p.hostId) - (a.id === p.hostId)).map((m) => (
              <span key={m.id} className={`sbpt-member${m.me ? " me" : ""}${m.id === p.hostId ? " host" : ""}`} data-no-i18n>
                {m.id === p.hostId && <span className="sbpt-crown">👑</span>}
                {m.name}
                {m.id === p.hostId && <span className="sbpt-host-label">Host</span>}
                {p.ready && <span className={`sbpt-rd${p.ready.ids.includes(m.id) ? " on" : ""}`}>{p.ready.ids.includes(m.id) ? "✓" : "…"}</span>}
              </span>
            ))}
          </div>
          {p.members.length < 2 && <div className="sbx-muted" style={{ margin: "6px 0" }}>Send the invite to a friend so they can join.</div>}

          {p.isHost ? (
            <div className="sbpt-hostbar">
              <label className="sbpt-switch">
                <input type="checkbox" checked={p.control === "all"} onChange={(e) => setControl(e.target.checked ? "all" : "host")} />
                <span className="sbpt-switch-ui" />
                <span>Everyone can control playback</span>
              </label>
              {!p.ready && (
                <button className="btn btn-secondary btn--sm" onClick={startReadyCheck} disabled={p.members.length < 2}>
                  Ready check
                </button>
              )}
            </div>
          ) : (
            p.control === "host" && <div className="sbx-muted sbpt-note">Only the host controls playback</div>
          )}

          {p.ready && (
            <div className="sbpt-ready">
              <div className="sbpt-ready-top">
                <b>Ready check</b>
                <span className="sbx-muted">
                  {p.ready.ids.length}/{p.members.length} ready
                </span>
              </div>
              {readyElsewhere && (
                <div className="sbx-muted" style={{ fontSize: 12 }}>
                  Open <b data-no-i18n>{mediaLabel(readyElsewhere)}</b> first so you start together.
                </div>
              )}
              <div className="sbpt-ready-btns">
                {!p.ready.meReady && <button className="btn btn-primary btn--sm" onClick={markReady}>I'm ready</button>}
                {p.ready.meReady && !p.isHost && <span className="sbx-muted">✓ You're ready. Waiting for the others…</span>}
                {p.isHost && (
                  <>
                    <button className="btn btn-primary btn--sm" onClick={startTogether}>Start now</button>
                    <button className="btn btn-ghost btn--sm" onClick={cancelReadyCheck}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          )}

          {elsewhere && (
            <div className="sbpt-elsewhere">
              <span data-no-i18n>{elsewhere.by}</span>&nbsp;is watching&nbsp;<b data-no-i18n>{mediaLabel(elsewhere)}</b>
              <button
                className="btn btn-primary btn--sm"
                onClick={() => window.__sbNav?.open?.({ id: elsewhere.id, media_type: elsewhere.media_type, title: elsewhere.title, name: elsewhere.title, season: elsewhere.season, episode: elsewhere.episode })}
              >
                Open it
              </button>
            </div>
          )}

          <div className="sbpt-tabs" role="tablist">
            <button role="tab" className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Chat</button>
            <button role="tab" className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
              Queue{p.queue.length ? ` · ${p.queue.length}` : ""}
            </button>
          </div>

          {tab === "queue" ? (
            <div className="sbpt-queue">
              {here && !p.queue.some((q) => sameMedia(q, here)) && (
                <button className="btn btn-secondary btn--sm sbpt-wide" onClick={() => addToQueue(here)}>
                  {p.isHost ? "＋ Add" : "＋ Suggest"} <span data-no-i18n>&nbsp;{mediaLabel(here)}</span>
                </button>
              )}
              {!p.queue.length ? (
                <div className="sbx-muted sbpt-empty">
                  {p.isHost ? "Nothing queued yet. Add titles from their page, and suggestions from the others show up here." : "Nothing queued yet. Suggest a title from its page and the host can play it for everyone."}
                </div>
              ) : (
                p.queue.map((q, i) => (
                  <div key={q.key} className="sbpt-qitem">
                    {q.poster_path ? <img src={`https://image.tmdb.org/t/p/w92${q.poster_path}`} alt="" loading="lazy" /> : <div className="sbpt-qph" />}
                    <div className="sbpt-qtext">
                      <div className="sbpt-qtitle" data-no-i18n>{mediaLabel(q)}</div>
                      {q.by && (
                        <div className="sbx-muted sbpt-qby">
                          <span>added by</span> <span data-no-i18n>{q.by}</span>
                        </div>
                      )}
                    </div>
                    {p.isHost && (
                      <div className="sbpt-qbtns">
                        <button className="btn btn-primary btn--sm" onClick={() => playFromQueue(q.key)} title="Play for everyone">▶</button>
                        <button className="icon-btn" disabled={i === 0} onClick={() => moveInQueue(q.key, -1)} aria-label="Move up">↑</button>
                        <button className="icon-btn" onClick={() => removeFromQueue(q.key)} aria-label="Remove">✕</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="sbpt-chat" ref={chatRef}>
                {p.chat.map((c, i) =>
                  c.sys ? (
                    <div key={i} className="sbpt-sys" data-no-i18n>{c.text}</div>
                  ) : (
                    <div key={i} className={`sbpt-msg${c.me ? " me" : ""}`} data-no-i18n>
                      {!c.me && (
                        <span className="sbpt-who">
                          {c.from === p.hostId && <span className="sbpt-crown">👑</span>}
                          {c.name}
                        </span>
                      )}
                      {c.text}
                    </div>
                  ),
                )}
              </div>
              <div className="sbpt-emoji">
                {EMOJI.map((e) => (
                  <button key={e} onClick={() => sendReaction(e)} aria-label={`React ${e}`}>{e}</button>
                ))}
              </div>
              <form
                className="sbpt-send"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChat(text);
                  setText("");
                }}
              >
                <input className="sbx-input" placeholder="Message" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
                <button className="btn btn-primary" type="submit" disabled={!text.trim()}>Send</button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** floating emoji reactions + the "3, 2, 1" before starting together (mounted once) */
export function PartyReactions() {
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(null);
  useEffect(() => {
    const h = (e) => {
      const id = Math.random();
      const x = 8 + Math.random() * 28;
      setItems((a) => [...a, { id, x, ...e.detail }]);
      setTimeout(() => setItems((a) => a.filter((i) => i.id !== id)), 2600);
    };
    let timers = [];
    const c = (e) => {
      timers.forEach(clearTimeout);
      const secs = Math.max(1, Math.round((e.detail?.ms || 3000) / 1000));
      timers = [];
      for (let i = 0; i <= secs; i++) timers.push(setTimeout(() => setCount(i === secs ? "▶" : secs - i), i * 1000));
      timers.push(setTimeout(() => setCount(null), secs * 1000 + 700));
    };
    window.addEventListener("streambert:party-react", h);
    window.addEventListener("streambert:party-countdown", c);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("streambert:party-react", h);
      window.removeEventListener("streambert:party-countdown", c);
    };
  }, []);
  return (
    <div className="sbpt-reactions" aria-hidden="true">
      {items.map((i) => (
        <div key={i.id} className="sbpt-react" style={{ right: `${i.x}%` }}>
          <span className="sbpt-react-emoji">{i.emoji}</span>
          <span className="sbpt-react-name">{i.me ? "" : i.name}</span>
        </div>
      ))}
      {count != null && (
        <div className="sbpt-count" key={String(count)}>
          {count}
        </div>
      )}
    </div>
  );
}
