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
    ready: S.ready ? { id: S.ready.id, media: S.ready.media, ids: [...S.ready.ids], meReady: S.ready.ids.has(S.me) } : null,
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

/** the link that opens Streambert straight into this party */
export const inviteLink = (code) => `streambert://party/${prettyCode(code)}`;
/** party code from an invite link / text, or null */
export function codeFromLink(text) {
  const m = String(text || "").match(/(?:streambert:\/\/party\/|[?#&]party=|\/join\/?#)([A-Za-z0-9]{5}-?[A-Za-z0-9]{5})/);
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
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, S.key, new TextEncoder().encode(JSON.stringify(obj))));
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
  if (!S?.client?.connected) return;
  const extra = isHost() ? { ctl: S.control } : {};
  seal({ ...msg, ...extra, from: S.me, name: S.name, host: isHost(), joinedAt: S.joinedAt, at: Date.now() })
    .then((data) => S?.client?.publish(S.topic, data, { qos: 0 }))
    .catch(() => {});
}
// the host's regular "I'm here" also carries the queue so late joiners get it
const ping = () => send({ type: "ping", media: S?.media, state: S?.lastState || null, ...(isHost() ? { queue: S.queue } : {}) });

async function connect(broker) {
  const { default: mqtt } = await import("mqtt");
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(broker, { clientId: "sb_" + Math.random().toString(16).slice(2, 12), clean: true, connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30 });
    const t = setTimeout(() => {
      client.end(true);
      reject(new Error("timeout"));
    }, 9000);
    client.once("connect", () => {
      clearTimeout(t);
      resolve(client);
    });
    client.once("error", (e) => {
      clearTimeout(t);
      client.end(true);
      reject(e);
    });
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
    hostState: null,
  };
  S.joinedAt = Date.now();
  S.host = starting ? S.me : null;
  S.members.set(S.me, { id: S.me, name: S.name, joinedAt: S.joinedAt, me: true });
  emit();
  let client = null;
  for (const b of BROKERS) {
    try {
      client = await connect(b);
      break;
    } catch {}
  }
  if (!S) return null;
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
    ping();
    // members that went quiet are gone
    const now = Date.now();
    for (const [id, m] of S.members) if (!m.me && now - (m.seenAt || 0) > 45000) S.members.delete(id);
    if (S.host && !S.members.has(S.host)) hostLeft();
    emit();
  }, 15000);
  emit();
  return getParty();
}

export async function leaveParty() {
  if (!S) return;
  const s = S;
  send({ type: "bye" });
  clearInterval(s.ping);
  clearTimeout(s.goTimer);
  S = null;
  setTimeout(() => {
    try {
      s.client?.end(true);
    } catch {}
  }, 300);
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
  }
  if (m.media) S.remoteMedia = { ...m.media, by: m.name };
  switch (m.type) {
    case "hello":
      if (!known) {
        addChat({ sys: true, text: `${m.name} joined`, at: Date.now() });
        notify({ name: m.name, text: "joined the party", sys: true, host: !!m.host });
      }
      ping(); // let them know we're here
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
        const t = Number(m.t) + (m.playing ? Math.max(0, (Date.now() - m.at) / 1000) : 0);
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
