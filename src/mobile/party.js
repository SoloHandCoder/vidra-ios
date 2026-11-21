// Watch party: watch together with friends on other phones / computers.
// Play, pause and seeking stay in sync; there's a small chat and reactions.
// The host can keep playback to themselves, run a ready check (everyone starts
// together after a countdown) and keeps a shared queue that others add to.
//
// Messages go through a free public MQTT server (several, with fallback), end-
// to-end encrypted: the AES-GCM key is derived from the room code (PBKDF2), the
// topic is a hash of the code. The server only ever sees random-looking bytes.
// mqtt.js is loaded only when a party starts.

const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const EVT = "streambert:party";
const COUNTDOWN = 3000;

let S = null; // { code, client, key, topic, me, name, members: Map, chat: [], media, host, control, queue, ready, ... }
const listeners = new Set();
const emit = () => {
  const st = getParty();
  listeners.forEach((f) => f(st));
  window.dispatchEvent(new CustomEvent(EVT, { detail: st }));
};
export const onParty = (f) => (listeners.add(f), () => listeners.delete(f));
export function getParty() {
  if (!S) return null;
  return {
    code: S.code,
    me: S.me,
    name: S.name,
    status: S.status,
    members: [...S.members.values()].sort((a, b) => a.joinedAt - b.joinedAt),
    chat: S.chat.slice(-100),
    media: S.media,
    remoteMedia: S.remoteMedia,
    hostId: S.host,
    isHost: S.host === S.me,
    control: S.control,
    canControl: canControl(),
    queue: S.queue.slice(),
    ready: S.ready ? { id: S.ready.id, media: S.ready.media, ids: [...S.ready.ids].filter((id) => S.members.has(id)), meReady: S.ready.ids.has(S.me) } : null,
    poll: pollView(),
  };
}

const isHost = () => !!S && S.host === S.me;
const canControl = () => !!S && (S.control === "all" || !S.host || S.host === S.me);

export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const prettyCode = (c) => {
  const s = cleanCode(c);
  return s.length > 5 ? `${s.slice(0, 5)}-${s.slice(5)}` : s;
};

/** web page that opens Vidra straight into this party (tappable in any chat app) */
export const INVITE_PAGE = "https://solohandcoder.github.io/vidra-desktop/join/";
export const inviteLink = (code) => `${INVITE_PAGE}#${prettyCode(code)}`;
/** the app link itself (what the invite page opens) */
export const appLink = (code) => `vidra://party/${prettyCode(code)}`;
/** party code from an invite link / text, or null */
export function codeFromLink(text) {
  const m = String(text || "").match(/(?:(?:streambert|vidra):\/\/party\/|[?#&](?:party|code)=|\/join\/?#)([A-Za-z0-9]{5}-?[A-Za-z0-9]{5})/);
  return m ? prettyCode(m[1]) : null;
}

async function derive(code) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(cleanCode(code)), "PBKDF2", false, ["deriveKey", "deriveBits"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("streambert-party-v1"), iterations: 150000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode("streambert-party-topic"), iterations: 1000, hash: "SHA-256" }, base, 128);
  const topic = "sbparty/" + [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { key, topic };
}
async function seal(obj, s = S) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, s.key, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function open(buf) {
  const b = new Uint8Array(buf);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, S.key, b.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

function send(msg) {
  const s = S; // the session this message belongs to (it may have ended by the time it's sealed)
  if (!s?.client?.connected) return Promise.resolve();
  const extra = isHost() ? { ctl: s.control } : {};
  return seal({ ...msg, ...extra, from: s.me, name: s.name, host: isHost(), joinedAt: s.joinedAt, at: Date.now() }, s)
    .then((data) => s.client.publish(s.topic, data, { qos: 0 }))
    .catch(() => {});
}
// the host's regular "I'm here" also carries the queue so late joiners get it
const ping = () =>
  send({
    type: "ping",
    media: S?.media,
    state: S?.lastState || null,
    // late joiners / reconnects get the queue and a running ready check
    ...(isHost() ? { queue: S.queue, ready: S.ready ? { id: S.ready.id, media: S.ready.media, t: S.ready.t } : null } : {}),
  });

async function connect(broker) {
  const { default: mqtt } = await import("mqtt");
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(broker, { clientId: "sb_" + Math.random().toString(16).slice(2, 12), clean: true, connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30 });
    const t = setTimeout(() => {
      client.end(true);
      reject(new Error("timeout"));
    }, 9000);
    const onError = (e) => {
      clearTimeout(t);
      client.end(true);
      reject(e);
    };
    client.once("connect", () => {
      clearTimeout(t);
      client.removeListener("error", onError);
      client.on("error", () => {}); // later errors (slow reconnects): mqtt.js retries by itself
      resolve(client);
    });
    client.once("error", onError);
  });
}

/** start a new party (code = null) or join one */
export async function joinParty(code, name) {
  await leaveParty();
  const starting = !code; // whoever starts a party hosts it
  code = code ? cleanCode(code) : cleanCode(newCode());
  if (code.length < 8) throw new Error("That code looks too short.");
  const pretty = `${code.slice(0, 5)}-${code.slice(5)}`;
  const { key, topic } = await derive(code);
  S = {
    code: pretty,
    key,
    topic,
    me: Math.random().toString(36).slice(2, 10),
    name: (name || "Guest").slice(0, 24),
    members: new Map(),
    chat: [],
    status: "connecting",
    media: null,
    remoteMedia: null,
    applyUntil: 0,
    control: "host",
    queue: [],
    ready: null,
    poll: null,
    hostState: null,
  };
  S.joinedAt = Date.now();
  S.host = starting ? S.me : null;
  S.members.set(S.me, { id: S.me, name: S.name, joinedAt: S.joinedAt, me: true });
  emit();
  const mine = S;
  let client = null;
  for (const b of BROKERS) {
    try {
      client = await connect(b);
      break;
    } catch {}
    if (S !== mine) break;
  }
  if (S !== mine) {
    // left, or joined another party, while this one was still connecting
    try {
      client?.end(true);
    } catch {}
    return null;
  }
  if (!client) {
    S = null;
    emit();
    throw new Error("Couldn't reach the watch party server. Check your connection and try again.");
  }
  S.client = client;
  S.status = "connected";
  client.on("message", (topic, payload) => {
    if (!S || topic !== S.topic) return;
    open(payload)
      .then(onMessage)
      .catch(() => {}); // not ours / wrong key
  });
  client.on("reconnect", () => S && ((S.status = "reconnecting"), emit()));
  client.on("connect", () => {
    if (!S) return;
    S.status = "connected";
    client.subscribe(S.topic);
    send({ type: "hello", media: S.media });
    emit();
  });
  client.subscribe(S.topic, { qos: 0 });
  send({ type: "hello", media: S.media });
  S.ping = setInterval(() => {
    if (S !== mine) return clearInterval(mine.ping);
    ping();
    // members that went quiet are gone
    const now = Date.now();
    for (const [id, m] of S.members) if (!m.me && now - (m.seenAt || 0) > 45000) S.members.delete(id);
    if (S.host && !S.members.has(S.host)) hostLeft();
    // nobody hosts (everyone joined by code): after a moment the longest-present member takes over
    if (!S.host) {
      S.noHost = (S.noHost || 0) + 1;
      if (S.noHost >= 2) hostLeft();
    } else S.noHost = 0;
    if (S.ready) checkAllReady(); // someone who left must not block the ready check
    emit();
  }, 15000);
  emit();
  return getParty();
}

export async function leaveParty() {
  if (!S) return;
  const s = S;
  const bye = send({ type: "bye" });
  clearInterval(s.ping);
  clearTimeout(s.goTimer);
  S = null;
  // disconnect only after "bye" went out, so the others see us leave right away
  Promise.resolve(bye).finally(() =>
    setTimeout(() => {
      try {
        s.client?.end(true);
      } catch {}
    }, 300),
  );
  emit();
}

// the host left: whoever has been in the party longest takes over
function hostLeft() {
  const old = S.host;
  S.host = null;
  const next = [...S.members.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || String(a.id).localeCompare(String(b.id)))[0];
  if (!next) return;
  S.host = next.id;
  if (old) addChat({ sys: true, text: `${next.me ? "You are" : next.name + " is"} now the host`, at: Date.now() });
  if (next.me) ping();
}

function addChat(entry) {
  S.chat.push(entry);
  if (S.chat.length > 200) S.chat.splice(0, S.chat.length - 200);
}

let applyHandler = null;
/** the player registers how to apply remote play / pause / seek */
export const setPartyPlayer = (fn) => (applyHandler = fn);
const apply = (st) => {
  S.applyUntil = Date.now() + 2500; // ignore our own player's reaction to it for a moment
  applyHandler?.(st);
};

// ---- queue -----------------------------------------------------------------
const mediaKey = (x) => (x ? `${x.media_type}_${x.id}_${x.season ?? ""}_${x.episode ?? ""}` : "");
export const sameMedia = (a, b) => !!a && !!b && mediaKey(a) === mediaKey(b);
const cleanItem = (x) =>
  x && x.id && (x.media_type === "movie" || x.media_type === "tv")
    ? {
        key: mediaKey(x),
        id: Number(x.id),
        media_type: x.media_type,
        title: String(x.title || x.name || "").slice(0, 120),
        season: x.season ?? null,
        episode: x.episode ?? null,
        poster_path: typeof x.poster_path === "string" ? x.poster_path.slice(0, 80) : null,
        by: String(x.by || "").slice(0, 24),
      }
    : null;

function shareQueue() {
  send({ type: "queue", queue: S.queue });
  emit();
}

/** add a title to the queue (the host adds it, everyone else suggests it) */
export function addToQueue(item) {
  const it = cleanItem({ ...item, by: S?.name });
  if (!S || !it) return false;
  if (S.queue.some((q) => q.key === it.key)) return false;
  if (isHost()) {
    S.queue.push(it);
    S.queue = S.queue.slice(0, 30);
    shareQueue();
  } else {
    send({ type: "suggest", item: it });
    addChat({ sys: true, text: `You suggested ${label(it)}`, at: Date.now() });
    emit();
  }
  return true;
}
export function removeFromQueue(key) {
  if (!isHost()) return;
  S.queue = S.queue.filter((q) => q.key !== key);
  shareQueue();
}
export function moveInQueue(key, dir) {
  if (!isHost()) return;
  const i = S.queue.findIndex((q) => q.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= S.queue.length) return;
  const q = S.queue.slice();
  [q[i], q[j]] = [q[j], q[i]];
  S.queue = q;
  shareQueue();
}
/** host: everyone opens this queue item now */
export function playFromQueue(key) {
  if (!isHost()) return;
  const it = S.queue.find((q) => q.key === key);
  if (!it) return;
  S.queue = S.queue.filter((q) => q.key !== key);
  send({ type: "goto", item: it });
  addChat({ sys: true, text: `Everyone is moving to ${label(it)}`, at: Date.now() });
  shareQueue();
  openItem(it);
}
/** host: everyone moves to this title / episode (up next) */
export function followMe(item) {
  if (!isHost()) return;
  const it = cleanItem({ ...item, by: S.name });
  if (!it) return;
  S.queue = S.queue.filter((q) => q.key !== it.key);
  send({ type: "goto", item: it });
  addChat({ sys: true, text: `Everyone is moving to ${label(it)}`, at: Date.now() });
  emit();
}
/** in a party but not the host: playback follows the host */
export const followsHost = () => !!S && !!S.host && S.host !== S.me;

/** host: the next queue item, if any */
export const nextInQueue = () => (S && isHost() ? S.queue[0] || null : null);

function openItem(it) {
  // partyPlay: the show page starts that episode straight away
  window.__sbNav?.open?.({ id: it.id, media_type: it.media_type, title: it.title, name: it.title, poster_path: it.poster_path, season: it.season, episode: it.episode, partyPlay: it.episode != null });
}
const label = (m) => `${m.title || ""}${m.media_type === "tv" && m.season != null ? ` S${m.season}E${m.episode}` : ""}`;

// ---- host controls ---------------------------------------------------------
/** host: "host" = only the host controls playback, "all" = everyone */
export function setControl(mode) {
  if (!isHost()) return;
  S.control = mode === "all" ? "all" : "host";
  addChat({ sys: true, text: S.control === "all" ? "Everyone can control playback" : "Only the host controls playback", at: Date.now() });
  ping();
  emit();
}

// ---- ready check -----------------------------------------------------------
/** host: pause everyone and wait until all are ready, then start together */
export function startReadyCheck() {
  if (!isHost()) return;
  const t = S.lastState?.t ?? 0;
  S.ready = { id: Math.random().toString(36).slice(2, 8), media: S.media, t, ids: new Set([S.me]) };
  send({ type: "ready-check", rid: S.ready.id, media: S.media, t });
  if (S.lastState) apply({ playing: false, t });
  addChat({ sys: true, text: "Ready check: waiting for everyone", at: Date.now() });
  emit();
}
export function markReady() {
  if (!S?.ready || S.ready.ids.has(S.me)) return;
  S.ready.ids.add(S.me);
  send({ type: "ready", rid: S.ready.id });
  emit();
}
export function cancelReadyCheck() {
  if (!isHost() || !S.ready) return;
  S.ready = null;
  send({ type: "ready-cancel" });
  emit();
}
/** host: start for everyone (after the countdown), even if not all are ready */
export function startTogether() {
  if (!isHost()) return;
  const t = S.ready?.t ?? S.lastState?.t ?? 0;
  send({ type: "go", t, media: S.ready?.media || S.media, delay: COUNTDOWN });
  countdownThenPlay(t, S.ready?.media || S.media);
}
function countdownThenPlay(t, media) {
  S.ready = null;
  window.dispatchEvent(new CustomEvent("streambert:party-countdown", { detail: { ms: COUNTDOWN } }));
  clearTimeout(S.goTimer);
  S.goTimer = setTimeout(() => {
    if (!S) return;
    if (!media || sameMedia(media, S.media)) apply({ playing: true, t });
  }, COUNTDOWN);
  emit();
}
function checkAllReady() {
  if (!isHost() || !S.ready) return;
  if ([...S.members.keys()].every((id) => S.ready.ids.has(id))) {
    addChat({ sys: true, text: "Everyone is ready!", at: Date.now() });
    startTogether();
  }
}

// ---- polls -----------------------------------------------------------------
// One poll at a time. Anyone can start one; whoever started it (or the host) ends it.
const cleanPoll = (q, options) => ({
  q: String(q || "").trim().slice(0, 120),
  options: (Array.isArray(options) ? options : []).map((o) => String(o || "").trim().slice(0, 80)).filter(Boolean).slice(0, 6),
});
function pollView() {
  const P = S.poll;
  if (!P) return null;
  const counts = P.options.map(() => 0);
  // while it runs only people still here count; a finished poll keeps its result
  for (const [id, i] of Object.entries(P.votes)) if ((P.closed || S.members.has(id)) && counts[i] != null) counts[i]++;
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...counts);
  return {
    id: P.id,
    q: P.q,
    options: P.options,
    counts,
    total,
    myVote: P.votes[S.me] ?? null,
    byName: P.byName,
    canEnd: P.by === S.me || isHost(),
    closed: !!P.closed,
    winners: total ? counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0) : [],
    queueKeys: P.queueKeys || null,
  };
}
/** start a poll; queueKeys (optional) ties each option to a queue item */
export function startPoll(q, options, queueKeys = null) {
  if (!S || (S.poll && !S.poll.closed)) return false;
  const c = cleanPoll(q, options);
  if (!c.q || c.options.length < 2) return false;
  S.poll = { id: Math.random().toString(36).slice(2, 8), ...c, votes: {}, by: S.me, byName: S.name, queueKeys: Array.isArray(queueKeys) ? queueKeys.slice(0, c.options.length) : null, closed: false };
  sendPoll();
  addChat({ sys: true, text: `You started a poll: ${c.q}`, at: Date.now() });
  emit();
  return true;
}
const sendPoll = () => send({ type: "poll", pid: S.poll.id, q: S.poll.q, options: S.poll.options, votes: S.poll.votes, queueKeys: S.poll.queueKeys });
export function votePoll(i) {
  if (!S?.poll || S.poll.closed || S.poll.options[i] == null) return;
  S.poll.votes[S.me] = i;
  send({ type: "vote", pid: S.poll.id, i });
  emit();
}
function closePoll(byName) {
  const P = S.poll;
  if (!P || P.closed) return;
  P.closed = true;
  const v = pollView();
  const text = v.total ? `${v.winners.map((i) => P.options[i]).join(" / ")} (${v.counts[v.winners[0]]}/${v.total})` : "no votes";
  addChat({ sys: true, text: `Poll ended${byName ? "" : ""}: ${P.q} → ${text}`, at: Date.now() });
}
export function endPoll() {
  if (!S?.poll || S.poll.closed || !(S.poll.by === S.me || isHost())) return;
  send({ type: "poll-end", pid: S.poll.id });
  closePoll();
  emit();
}
/** hide a finished poll */
export function clearPoll() {
  if (S?.poll?.closed) {
    S.poll = null;
    emit();
  }
}

// ---- incoming --------------------------------------------------------------
let lastBlockedNote = 0;

function onMessage(m) {
  if (!S || !m || m.from === S.me) return;
  const known = S.members.get(m.from);
  S.members.set(m.from, { id: m.from, name: String(m.name || "Guest").slice(0, 24), joinedAt: m.joinedAt || known?.joinedAt || m.at || Date.now(), seenAt: Date.now() });
  if (m.host) {
    // two hosts (after a hand-over race): the one who joined first keeps it
    if (S.host === S.me && S.host !== m.from) {
      const mine = S.joinedAt || 0, theirs = m.joinedAt || 0;
      if (theirs < mine || (theirs === mine && m.from < S.me)) S.host = m.from;
    } else S.host = m.from;
  }
  const fromHost = !!m.host && S.host === m.from;
  if (fromHost) {
    if (m.ctl === "all" || m.ctl === "host") S.control = m.ctl;
    if (Array.isArray(m.queue)) S.queue = m.queue.map(cleanItem).filter(Boolean).slice(0, 30);
    if (m.state && sameMedia(m.media, S.media)) S.hostState = { playing: !!m.state.playing, t: Number(m.state.t) || 0, at: Date.now() };
    // a ready check that started before we joined / while we were reconnecting
    if (m.type === "ping" && "ready" in m) {
      if (m.ready && S.ready?.id !== String(m.ready.id)) {
        S.ready = { id: String(m.ready.id), media: m.ready.media || null, t: Number(m.ready.t) || 0, ids: new Set([m.from]) };
        window.dispatchEvent(new CustomEvent("streambert:party-ready-check", { detail: { name: m.name } }));
      } else if (!m.ready && S.ready) S.ready = null;
    }
  }
  if (m.media) S.remoteMedia = { ...m.media, by: m.name };
  switch (m.type) {
    case "hello":
      if (!known) {
        addChat({ sys: true, text: `${m.name} joined`, at: Date.now() });
        notify({ name: m.name, text: "joined the party", sys: true, host: !!m.host });
      }
      ping(); // let them know we're here
      if (S.poll && !S.poll.closed && S.poll.by === S.me) sendPoll(); // late joiners see the running poll
      break;
    case "bye":
      S.members.delete(m.from);
      addChat({ sys: true, text: `${m.name} left`, at: Date.now() });
      if (S.host === m.from) hostLeft();
      if (S.ready) checkAllReady();
      break;
    case "chat":
      addChat({ from: m.from, name: m.name, text: String(m.text || "").slice(0, 500), at: m.at });
      notify({ name: m.name, text: String(m.text || "").slice(0, 140), host: !!m.host });
      break;
    case "react":
      window.dispatchEvent(new CustomEvent("streambert:party-react", { detail: { emoji: String(m.emoji || "").slice(0, 4), name: m.name } }));
      break;
    case "sync":
      if (!sameMedia(m.media, S.media)) break; // they're watching something else
      if (S.control === "host" && S.host && !fromHost) break; // only the host controls playback
      {
        const t = Number(m.t) + (m.playing ? Math.min(2, Math.max(0, (Date.now() - m.at) / 1000)) : 0);
        if (fromHost) S.hostState = { playing: !!m.playing, t, at: Date.now() };
        apply({ playing: !!m.playing, t });
      }
      addChat({ sys: true, text: `${m.name} ${m.reason === "seek" ? "jumped to " + fmt(m.t) : m.playing ? "pressed play" : "paused"}`, at: Date.now() });
      break;
    case "suggest":
      if (isHost()) {
        const it = cleanItem({ ...m.item, by: m.name });
        if (it && !S.queue.some((q) => q.key === it.key)) {
          S.queue.push(it);
          S.queue = S.queue.slice(0, 30);
          addChat({ sys: true, text: `${m.name} suggested ${label(it)}`, at: Date.now() });
          notify({ name: m.name, text: `suggested ${label(it)}`, sys: true });
          shareQueue();
        }
      }
      break;
    case "queue":
      if (fromHost && Array.isArray(m.queue)) S.queue = m.queue.map(cleanItem).filter(Boolean).slice(0, 30);
      break;
    case "goto":
      if (fromHost) {
        const it = cleanItem(m.item);
        if (it) {
          addChat({ sys: true, text: `${m.name} opened ${label(it)} for everyone`, at: Date.now() });
          notify({ name: m.name, text: `opened ${label(it)}`, sys: true, host: true });
          openItem(it);
        }
      }
      break;
    case "ready-check":
      if (fromHost) {
        S.ready = { id: String(m.rid), media: m.media || null, t: Number(m.t) || 0, ids: new Set([m.from]) };
        if (S.lastState && sameMedia(m.media, S.media)) apply({ playing: false, t: Number(m.t) || 0 });
        addChat({ sys: true, text: `${m.name} started a ready check`, at: Date.now() });
        window.dispatchEvent(new CustomEvent("streambert:party-ready-check", { detail: { name: m.name } }));
      }
      break;
    case "ready":
      if (S.ready && String(m.rid) === S.ready.id) {
        S.ready.ids.add(m.from);
        checkAllReady();
      }
      break;
    case "ready-cancel":
      if (fromHost) S.ready = null;
      break;
    case "poll":
      {
        const c = cleanPoll(m.q, m.options);
        if (!c.q || c.options.length < 2) break;
        const same = S.poll && S.poll.id === String(m.pid);
        if (S.poll && !S.poll.closed && !same) break; // one poll at a time
        const votes = same ? S.poll.votes : {};
        if (m.votes && typeof m.votes === "object") for (const [id, i] of Object.entries(m.votes)) if (Number.isInteger(i) && votes[id] == null) votes[id] = i;
        if (!same) {
          addChat({ sys: true, text: `${m.name} started a poll: ${c.q}`, at: Date.now() });
          notify({ name: m.name, text: `Poll: ${c.q}`, sys: true, host: !!m.host });
        }
        S.poll = { id: String(m.pid), ...c, votes, by: m.from, byName: m.name, queueKeys: Array.isArray(m.queueKeys) ? m.queueKeys.map(String).slice(0, c.options.length) : null, closed: same ? S.poll.closed : false };
      }
      break;
    case "vote":
      if (S.poll && !S.poll.closed && String(m.pid) === S.poll.id && Number.isInteger(m.i) && S.poll.options[m.i] != null) S.poll.votes[m.from] = m.i;
      break;
    case "poll-end":
      if (S.poll && String(m.pid) === S.poll.id && (m.from === S.poll.by || fromHost)) closePoll(m.name);
      break;
    case "go":
      if (fromHost) countdownThenPlay(Number(m.t) || 0, m.media || null);
      break;
  }
  emit();
}

// for the small pop-up when the chat isn't open
function notify(d) {
  window.dispatchEvent(new CustomEvent("streambert:party-message", { detail: d }));
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0");
};

export function sendChat(text) {
  if (!S || !String(text).trim()) return;
  const t = String(text).trim().slice(0, 500);
  addChat({ from: S.me, name: S.name, text: t, at: Date.now(), me: true });
  send({ type: "chat", text: t });
  emit();
}
export function sendReaction(emoji) {
  if (!S) return;
  send({ type: "react", emoji });
  window.dispatchEvent(new CustomEvent("streambert:party-react", { detail: { emoji, name: S.name, me: true } }));
}

/**
 * The player calls this about every second with what it's showing.
 * media: { id, media_type, title, season?, episode? } | null; state: { playing, t } | null
 */
export function reportPlayer(media, state) {
  if (!S) return;
  if (mediaKey(media) !== mediaKey(S.media)) {
    S.media = media || null;
    S.hostState = null;
    ping();
    emit();
  }
  if (!state || !media) {
    S.lastState = null;
    return;
  }
  const now = Date.now();
  const prev = S.lastState;
  S.lastState = { ...state, at: now };
  if (now < S.applyUntil) return; // that change came from the party
  if (!prev) return;
  const expected = prev.playing ? prev.t + (now - prev.at) / 1000 : prev.t;
  let reason = null;
  if (state.playing !== prev.playing) reason = state.playing ? "play" : "pause";
  else if (Math.abs(state.t - expected) > 4) reason = "seek";
  if (!reason) return;
  if (canControl()) {
    if (isHost()) S.hostState = { playing: state.playing, t: state.t, at: now };
    send({ type: "sync", media, playing: state.playing, t: state.t, reason });
    return;
  }
  // only the host controls playback: go back to where the host is
  const h = S.hostState;
  if (h) apply({ playing: h.playing, t: h.playing ? h.t + (now - h.at) / 1000 : h.t });
  if (now - lastBlockedNote > 6000) {
    lastBlockedNote = now;
    notify({ name: "Watch party", text: "Only the host controls playback", sys: true });
  }
}
