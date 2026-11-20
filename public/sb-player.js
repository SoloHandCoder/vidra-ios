/* Vidra in-app player (public/sb-player.html).
 * URL params: src, title, t, key, sub, subs (JSON [{url,label,lang}]), close=1, cast=1, type=hls|mp4
 * Talks to the host page with window.parent.postMessage({ __sb: "player", cmd, ... }, "*").
 */
(function () {
  "use strict";

  var q = new URLSearchParams(location.search);
  var SRC = q.get("src") || "";
  var TITLE = q.get("title") || "";
  var START = Math.max(0, Number(q.get("t") || 0) || 0);
  var KEY = q.get("key") || SRC;
  var CAN_CLOSE = q.get("close") === "1";
  var CAN_CAST = q.get("cast") === "1";
  var FRAMED = window.parent && window.parent !== window;
  var SEEK_STEP = 10;
  var HIDE_MS = 3000;

  var $ = function (s) { return document.querySelector(s); };
  var root = $("#sb");
  var video = $("#v");
  var ui = {
    close: $(".b-close"), title: $(".title"), cc: $(".b-cc"), cast: $(".b-cast"), pip: $(".b-pip"),
    play: $(".b-play"), back: $(".b-back10"), fwd: $(".b-fwd10"),
    seek: $(".seek"), buf: $(".seek-buf"), fill: $(".seek-fill"), mover: $(".seek-mover"),
    tipMover: $(".seek-tip-mover"), tip: $(".seek-tip"),
    cur: $(".t-cur"), dur: $(".t-dur"), speed: $(".b-speed"), quality: $(".b-quality"),
    menu: $(".menu"), menuTitle: $(".menu-title"), menuList: $(".menu-list"),
    rippleL: $(".ripple-l"), rippleR: $(".ripple-r"),
    scrub: $(".scrub-hud"), scrubTime: $(".scrub-time"), scrubDelta: $(".scrub-delta"),
    level: $(".level-hud"), levelIcon: $(".level-icon"), levelFill: $(".level-fill"), levelPct: $(".level-pct"),
    err: $(".err"), errMsg: $(".err-msg"), retry: $(".err-retry"), fs: $(".b-fs"),
  };

  /* ── helpers ──────────────────────────────────────────────────────── */
  function post(msg) {
    msg.__sb = "player";
    try { if (FRAMED) window.parent.postMessage(msg, "*"); } catch (e) {}
  }
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dur() { var d = video.duration; return isFinite(d) && d > 0 ? d : 0; }
  function cls(name, on) { root.classList.toggle(name, !!on); }

  /* ── fonts: reuse the host app's @font-face rules (hashed asset URLs) ── */
  (function loadFonts() {
    var css = "";
    try {
      var sheets = window.parent.document.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        var base = sheets[i].href || window.parent.location.href, rules;
        try { rules = sheets[i].cssRules; } catch (e) { continue; }
        for (var j = 0; j < rules.length; j++) {
          var r = rules[j];
          if (r.type !== 5 /* FONT_FACE */) continue;
          var fam = (r.style.getPropertyValue("font-family") || "").replace(/["']/g, "");
          if (!/DM Sans|Bebas Neue/i.test(fam)) continue;
          css += r.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, function (_, qt, u) {
            try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return _; }
          }) + "\n";
        }
      }
    } catch (e) {}
    if (!css) {
      // Standalone (dev server): load straight from the source tree.
      var f = "/fonts/";
      css =
        '@font-face{font-family:"Bebas Neue";src:local("Bebas Neue"),url("' + f + 'bebas-neue-regular.woff2") format("woff2");font-weight:400;font-display:swap}' +
        '@font-face{font-family:"DM Sans";src:url("' + f + 'dm-sans-regular.woff2") format("woff2");font-weight:400;font-display:swap}' +
        '@font-face{font-family:"DM Sans";src:url("' + f + 'dm-sans-500.woff2") format("woff2");font-weight:500;font-display:swap}' +
        '@font-face{font-family:"DM Sans";src:url("' + f + 'dm-sans-600.woff2") format("woff2");font-weight:600;font-display:swap}';
    }
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  })();

  /* ── static UI setup ──────────────────────────────────────────────── */
  ui.title.textContent = TITLE;
  if (TITLE) document.title = TITLE;
  ui.close.hidden = !CAN_CLOSE;
  ui.cast.hidden = !CAN_CAST;
  if (!FRAMED && !document.pictureInPictureEnabled) ui.pip.hidden = true;

  /* ── controls visibility ──────────────────────────────────────────── */
  var hideTimer = 0;
  var uiShown = true;
  function showUI(keep) {
    if (!uiShown) { uiShown = true; cls("show-ui", 1); cls("hide-ui", 0); }
    clearTimeout(hideTimer);
    if (!keep) hideTimer = setTimeout(autoHide, HIDE_MS);
  }
  function hideUI() {
    clearTimeout(hideTimer);
    if (menuOpen) closeMenu();
    if (!uiShown) return;
    uiShown = false; cls("show-ui", 0); cls("hide-ui", 1);
    var a = document.activeElement;
    if (a && a !== document.body && root.contains(a)) { clearKbFocus(); root.focus({ preventScroll: true }); }
  }
  function autoHide() {
    if (video.paused || dragging || menuOpen || root.classList.contains("has-error")) return;
    hideUI();
  }
  function toggleUI() { uiShown ? hideUI() : showUI(); }

  /* ── playback ─────────────────────────────────────────────────────── */
  function play() { var p = video.play(); if (p && p.catch) p.catch(function () { syncPlay(); showUI(true); }); }
  function togglePlay() { video.paused || video.ended ? play() : video.pause(); }
  function seekTo(t) {
    var d = dur();
    t = d ? clamp(t, 0, Math.max(0, d - 0.25)) : Math.max(0, t);
    try { video.currentTime = t; } catch (e) {}
    renderTime(t);
  }
  function seekBy(dt) { seekTo((pendingSeek != null ? pendingSeek : video.currentTime) + dt); }
  var pendingSeek = null; // keep accumulated target while the media element is still seeking
  video.addEventListener("seeking", function () { pendingSeek = video.currentTime; });
  video.addEventListener("seeked", function () { pendingSeek = null; });

  function syncPlay() {
    var paused = video.paused || video.ended;
    cls("is-paused", paused);
    ui.play.setAttribute("aria-label", paused ? "Play" : "Pause");
  }
  video.addEventListener("play", function () { syncPlay(); showUI(); });
  video.addEventListener("playing", function () { syncPlay(); setLoading(false); });
  video.addEventListener("pause", function () { syncPlay(); showUI(true); reportPosition(); });
  video.addEventListener("ended", function () { syncPlay(); showUI(true); reportPosition(); });

  // loading spinner
  var loading = false;
  function setLoading(on) { if (on !== loading) { loading = on; cls("is-loading", on); } }
  ["waiting", "seeking", "loadstart", "stalled"].forEach(function (ev) {
    video.addEventListener(ev, function () { if (video.readyState < 3 || ev !== "stalled") setLoading(true); });
  });
  ["canplay", "canplaythrough", "seeked", "playing", "loadeddata"].forEach(function (ev) {
    video.addEventListener(ev, function () { if (video.readyState >= 3 || ev === "playing") setLoading(false); });
  });
  setLoading(true);

  /* ── time + seek bar rendering (rAF batched) ──────────────────────── */
  var rafPending = false, dispTime = 0;
  function renderTime(t) { dispTime = t; schedule(); }
  function schedule() { if (!rafPending) { rafPending = true; requestAnimationFrame(paint); } }
  function bufferedEnd(t) {
    var b = video.buffered;
    for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
    return 0;
  }
  var lastCurTxt = "", lastDurTxt = "";
  function paint() {
    rafPending = false;
    var d = dur();
    var t = dragging ? dragTime : dispTime;
    var p = d ? clamp(t / d, 0, 1) : 0;
    ui.fill.style.transform = "scaleX(" + p + ")";
    ui.mover.style.transform = "translate3d(" + p * 100 + "%,0,0)";
    ui.buf.style.transform = "scaleX(" + (d ? clamp(bufferedEnd(video.currentTime) / d, 0, 1) : 0) + ")";
    var ct = fmt(t), dt = fmt(d);
    if (ct !== lastCurTxt) { ui.cur.textContent = lastCurTxt = ct; ui.seek.setAttribute("aria-valuenow", Math.floor(t)); }
    if (dt !== lastDurTxt) { ui.dur.textContent = lastDurTxt = dt; ui.seek.setAttribute("aria-valuemax", Math.floor(d)); }
    if (dragging) {
      ui.tipMover.style.transform = "translate3d(" + clamp(p * seekW, 28, seekW - 28) + "px,0,0)";
      ui.tip.textContent = ct;
    }
  }
  video.addEventListener("timeupdate", function () { if (!dragging) renderTime(video.currentTime); });
  video.addEventListener("progress", schedule);
  video.addEventListener("durationchange", schedule);
  video.addEventListener("loadedmetadata", schedule);

  /* ── seek bar dragging ────────────────────────────────────────────── */
  var dragging = false, dragTime = 0, seekLeft = 0, seekW = 1, dragId = null, wasPlaying = false;
  function timeAtX(x) { return clamp((x - seekLeft) / seekW, 0, 1) * dur(); }
  ui.seek.addEventListener("pointerdown", function (e) {
    if (!uiShown || !dur()) return;
    if (e.button && e.button !== 0) return;
    e.stopPropagation();
    var r = ui.seek.getBoundingClientRect(); // single layout read per drag
    seekLeft = r.left; seekW = r.width || 1;
    dragging = true; dragId = e.pointerId; dragTime = timeAtX(e.clientX);
    try { ui.seek.setPointerCapture(e.pointerId); } catch (x) {}
    ui.seek.classList.add("dragging");
    showUI(true);
    schedule();
  });
  ui.seek.addEventListener("pointermove", function (e) {
    if (!dragging || e.pointerId !== dragId) return;
    dragTime = timeAtX(e.clientX);
    schedule();
  });
  function endDrag(e, commit) {
    if (!dragging || (e && e.pointerId !== dragId)) return;
    dragging = false; dragId = null;
    ui.seek.classList.remove("dragging");
    if (commit) seekTo(dragTime);
    showUI();
  }
  ui.seek.addEventListener("pointerup", function (e) { endDrag(e, true); });
  ui.seek.addEventListener("pointercancel", function (e) { endDrag(e, true); });
  ui.seek.addEventListener("lostpointercapture", function (e) { endDrag(e, true); });

  /* ── buttons ──────────────────────────────────────────────────────── */
  function onTap(el, fn) {
    el.addEventListener("click", function (e) { e.stopPropagation(); fn(e); showUI(); });
    el.addEventListener("pointerdown", function (e) { e.stopPropagation(); }, { passive: true });
  }
  onTap(ui.play, togglePlay);
  onTap(ui.back, function () { seekBy(-SEEK_STEP); });
  onTap(ui.fwd, function () { seekBy(SEEK_STEP); });
  onTap(ui.close, closePlayer);
  onTap(ui.cast, function () { post({ cmd: "cast", t: video.currentTime || 0 }); video.pause(); });
  onTap(ui.pip, function () {
    if (FRAMED) return post({ cmd: "pip" });
    try { document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture(); } catch (e) {}
  });
  onTap(ui.speed, function () { openSpeedMenu(); });
  onTap(ui.quality, function () { openQualityMenu(); });
  onTap(ui.cc, function () {
    openSubMenu();
  });
  onTap(ui.retry, retry);
  // Fullscreen (not needed for the offline player, which is already fullscreen).
  // Inside the app the request is turned into the app's own fullscreen mode.
  ui.fs.hidden = CAN_CLOSE;
  onTap(ui.fs, function () {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else (root.requestFullscreen || root.webkitRequestFullscreen).call(root).catch(function () {});
    } catch (e) {}
  });

  function closePlayer() {
    reportPosition();
    post({ cmd: "close" });
  }

  /* ── menus ────────────────────────────────────────────────────────── */
  var menuOpen = false, menuKind = "";
  var CHK = '<svg class="chk" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  function openMenu(kind, title, items, anchorTop) {
    if (menuOpen && menuKind === kind) return closeMenu();
    menuKind = kind;
    ui.menuTitle.textContent = title;
    ui.menuList.textContent = "";
    var selEl = null;
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "menu-item" + (it.sel ? " sel" : "");
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", it.sel ? "true" : "false");
      b.innerHTML = CHK + "<span></span>" + (it.sub ? '<span class="sub"></span>' : "");
      b.children[1].textContent = it.label;
      if (it.sub) b.children[2].textContent = it.sub;
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (it.run() === "keep" && it.reopen) { menuOpen = false; it.reopen(); return; }
        closeMenu(); showUI();
      });
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); }, { passive: true });
      ui.menuList.appendChild(b);
      if (it.sel) selEl = b;
    });
    ui.menu.classList.toggle("top-anchored", !!anchorTop);
    ui.menu.classList.add("on");
    ui.menu.setAttribute("aria-hidden", "false");
    menuOpen = true;
    showUI(true);
    if (kbMode) focusEl(selEl || ui.menuList.firstChild);
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    ui.menu.classList.remove("on");
    ui.menu.setAttribute("aria-hidden", "true");
    var opener = { speed: ui.speed, quality: ui.quality, subs: ui.cc }[menuKind];
    if (kbMode && opener) focusEl(opener);
    showUI();
  }
  ui.menu.addEventListener("pointerdown", function (e) { e.stopPropagation(); }, { passive: true });

  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  // remembered between videos (same origin as the app → shared localStorage)
  var PREF_SPEED = "streambert_playerSpeed", PREF_QUALITY = "streambert_playerQuality";
  function prefGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function prefSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var savedSpeed = Number(prefGet(PREF_SPEED)) || 1;
  if (savedSpeed !== 1) {
    video.playbackRate = savedSpeed;
    video.defaultPlaybackRate = savedSpeed;
    // some engines reset the rate when the source loads
    video.addEventListener("loadedmetadata", function () { video.playbackRate = savedSpeed; }, { once: true });
  }
  function openSpeedMenu() {
    openMenu("speed", "Speed", SPEEDS.map(function (s) {
      return {
        label: s === 1 ? "Normal" : s + "x", sel: Math.abs(video.playbackRate - s) < 0.01,
        run: function () { video.playbackRate = s; video.defaultPlaybackRate = s; prefSet(PREF_SPEED, s); },
      };
    }));
  }
  video.addEventListener("ratechange", function () {
    var r = video.playbackRate;
    ui.speed.textContent = (Math.round(r * 100) / 100) + "x";
  });

  /* ── subtitles ────────────────────────────────────────────────────── */
  var subTracks = []; // { el, label }
  var activeSub = -1;
  function srtToVtt(txt) {
    txt = String(txt).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (/^WEBVTT/.test(txt)) return txt;
    var out = txt
      .split(/\n{2,}/)
      .map(function (block) {
        var lines = block.split("\n");
        if (/^\d+$/.test(lines[0].trim()) && lines[1] && /-->/.test(lines[1])) lines.shift();
        if (lines[0]) {
          lines[0] = lines[0].replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g, function (_, h, m, s, ms) {
            return (h.length < 2 ? "0" + h : h) + ":" + m + ":" + s + "." + (ms + "00").slice(0, 3);
          }).replace(/(\d{2}):(\d{2})[,.](\d{3})(?=\s*-->|\s*$)/g, function (m0) { return m0.replace(",", "."); });
        }
        return lines.join("\n");
      })
      .join("\n\n");
    return "WEBVTT\n\n" + out + "\n";
  }
  function isSrt(url) {
    var u = url;
    try { u = decodeURIComponent(url); } catch (e) {}
    return /\.srt(?:$|[?#&])/i.test(u);
  }
  function addTrack(url, label, lang, idx) {
    var el = document.createElement("track");
    el.kind = "subtitles";
    el.label = label || "Subtitles " + (idx + 1);
    el.srclang = (lang || "und").slice(0, 8);
    var entry = { el: el, label: el.label, lang: lang || "" };
    subTracks.push(entry);
    var attach = function (finalUrl) {
      el.src = finalUrl;
      el.addEventListener("load", function () { onTrackLoaded(entry); });
      video.appendChild(el);
      el.track.mode = "disabled";
      if (subTracks.indexOf(entry) === 0 && activeSub === -1 && !subTouched) setSub(0);
      else applySubModes();
    };
    if (isSrt(url)) {
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      }).then(function (txt) {
        attach(URL.createObjectURL(new Blob([srtToVtt(txt)], { type: "text/vtt" })));
      }).catch(function () {
        subTracks.splice(subTracks.indexOf(entry), 1);
        updateCC();
      });
    } else attach(url);
    updateCC();
  }
  var subTouched = false;
  function applySubModes() {
    subTracks.forEach(function (s, i) { if (s.el.track) s.el.track.mode = i === activeSub ? "showing" : "disabled"; });
    // Keep any tracks hls.js or the browser added in sync, too.
    for (var i = 0; i < video.textTracks.length; i++) {
      var tt = video.textTracks[i];
      var mine = subTracks.some(function (s) { return s.el.track === tt; });
      if (!mine) tt.mode = "disabled";
    }
    updateCC();
  }
  function setSub(i) { subTouched = true; activeSub = i; applySubModes(); applyCueLayout(); }

  /* ── subtitle style (remembered) & timing (remembered per video) ─────── */
  var STYLE_KEY = "streambert_subtitleStyle";
  var SIZES = [["s", "Small", 0.85], ["m", "Medium", 1.05], ["l", "Large", 1.35], ["xl", "Extra large", 1.7]];
  var COLORS = [["#ffffff", "White"], ["#ffe14d", "Yellow"], ["#7ee3ff", "Cyan"], ["#9dff8a", "Green"]];
  var BGS = [["dark", "Dark box"], ["solid", "Black box"], ["none", "No box (outline)"]];
  var POSITIONS = [["bottom", "Bottom"], ["higher", "Higher"], ["top", "Top"]];
  function subStyle() {
    var d = { size: "m", color: "#ffffff", bg: "dark", position: "bottom" };
    try { var v = JSON.parse(localStorage.getItem(STYLE_KEY)); if (v) for (var k in d) if (v[k]) d[k] = v[k]; } catch (e) {}
    return d;
  }
  function saveSubStyle(st) { try { localStorage.setItem(STYLE_KEY, JSON.stringify(st)); } catch (e) {} applySubStyle(); }
  var cueStyleEl = document.createElement("style");
  document.head.appendChild(cueStyleEl);
  function applySubStyle() {
    var st = subStyle();
    var size = (SIZES.filter(function (x) { return x[0] === st.size; })[0] || SIZES[1])[2];
    var bg = st.bg === "none" ? "transparent" : st.bg === "solid" ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.62)";
    var shadow = st.bg === "none"
      ? "0 0 3px #000, 0 0 3px #000, 1px 1px 2px #000, -1px -1px 2px #000"
      : "0 1px 2px rgba(0,0,0,0.8)";
    cueStyleEl.textContent = "video::cue{font-size:" + size + "em;color:" + st.color + ";background:" + bg + ";text-shadow:" + shadow + "}";
    applyCueLayout();
  }
  function cuesOf(entry) { return entry && entry.el.track && entry.el.track.cues ? entry.el.track.cues : null; }
  function applyCueLayout() {
    var pos = subStyle().position;
    subTracks.forEach(function (entry) {
      var cues = cuesOf(entry);
      if (!cues) return;
      for (var i = 0; i < cues.length; i++) {
        var c = cues[i];
        c.snapToLines = true;
        c.line = pos === "top" ? 1 : pos === "higher" ? -4 : "auto";
      }
    });
  }
  // timing offset: shifts every cue of every track
  var OFFSET_KEY = "streambert_subOffset_" + (q.get("key") || SRC || "").slice(0, 200);
  var subOffset = 0;
  try { subOffset = Number(JSON.parse(localStorage.getItem(OFFSET_KEY))) || 0; } catch (e) {}
  function shiftEntry(entry, delta) {
    var cues = cuesOf(entry);
    if (!cues || !delta) return;
    for (var i = 0; i < cues.length; i++) {
      cues[i].startTime = Math.max(0, cues[i].startTime + delta);
      cues[i].endTime = Math.max(0, cues[i].endTime + delta);
    }
  }
  function setOffset(v) {
    v = Math.round(v * 10) / 10;
    var delta = v - subOffset;
    subOffset = v;
    subTracks.forEach(function (e) { if (e.shifted) shiftEntry(e, delta); });
    try { localStorage.setItem(OFFSET_KEY, JSON.stringify(v)); } catch (e) {}
    toast("Subtitle delay " + (v > 0 ? "+" : "") + v.toFixed(1) + " s");
  }
  function onTrackLoaded(entry) {
    if (!entry.shifted) { entry.shifted = true; shiftEntry(entry, subOffset); }
    applyCueLayout();
  }
  function toast(t) {
    var el = document.querySelector(".sb-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "sb-toast";
      el.style.cssText = "position:absolute;left:50%;top:18%;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;" +
        "padding:8px 14px;border-radius:18px;font:600 14px var(--font-body);pointer-events:none;z-index:40;transition:opacity .2s";
      root.appendChild(el);
    }
    el.textContent = t;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = "0"; }, 1400);
  }
  function label(list, v) { return (list.filter(function (x) { return x[0] === v; })[0] || list[0])[1]; }
  function cycle(list, v) { var i = list.map(function (x) { return x[0]; }).indexOf(v); return list[(i + 1) % list.length][0]; }
  function openStyleMenu() {
    var st = subStyle();
    var keep = function (fn) { return function () { fn(); return "keep"; }; };
    var items = [
      { label: "Size: " + label(SIZES, st.size), run: keep(function () { st.size = cycle(SIZES, st.size); saveSubStyle(st); }) },
      { label: "Color: " + label(COLORS, st.color), run: keep(function () { st.color = cycle(COLORS, st.color); saveSubStyle(st); }) },
      { label: "Background: " + label(BGS, st.bg), run: keep(function () { st.bg = cycle(BGS, st.bg); saveSubStyle(st); }) },
      { label: "Position: " + label(POSITIONS, st.position), run: keep(function () { st.position = cycle(POSITIONS, st.position); saveSubStyle(st); }) },
      { label: "Reset style", run: keep(function () { saveSubStyle({ size: "m", color: "#ffffff", bg: "dark", position: "bottom" }); }) },
    ];
    items.forEach(function (it) { it.reopen = openStyleMenu; });
    openMenu("substyle", "Subtitle style", items, true);
  }
  function openTimingMenu() {
    var keep = function (fn) { return function () { fn(); return "keep"; }; };
    var items = [
      { label: "Show earlier  (−0.5 s)", run: keep(function () { setOffset(subOffset - 0.5); }) },
      { label: "Show later  (+0.5 s)", run: keep(function () { setOffset(subOffset + 0.5); }) },
      { label: "Fine: −0.1 s", run: keep(function () { setOffset(subOffset - 0.1); }) },
      { label: "Fine: +0.1 s", run: keep(function () { setOffset(subOffset + 0.1); }) },
      { label: "Reset delay", sub: "now " + (subOffset > 0 ? "+" : "") + subOffset.toFixed(1) + " s", run: keep(function () { setOffset(0); }) },
    ];
    items.forEach(function (it) { it.reopen = openTimingMenu; });
    openMenu("subtiming", "Subtitle timing", items, true);
  }
  applySubStyle();
  // the app's settings page can change the style while a player is open
  window.addEventListener("storage", function (e) { if (e.key === STYLE_KEY) applySubStyle(); });
  function updateCC() {
    ui.cc.hidden = subTracks.length === 0;
    ui.cc.classList.toggle("on", activeSub >= 0);
    ui.cc.setAttribute("aria-pressed", activeSub >= 0 ? "true" : "false");
  }
  function openSubMenu() {
    var items = [{ label: "Off", sel: activeSub < 0, run: function () { setSub(-1); } }];
    subTracks.forEach(function (s, i) {
      items.push({ label: s.label, sub: s.lang && s.lang !== s.label ? s.lang : "", sel: activeSub === i, run: function () { setSub(i); } });
    });
    items.push({ label: "Style…", sub: "size, color, background, position", run: function () { setTimeout(openStyleMenu, 0); } });
    items.push({
      label: "Timing…",
      sub: subOffset ? "delay " + (subOffset > 0 ? "+" : "") + subOffset.toFixed(1) + " s" : "in sync",
      run: function () { setTimeout(openTimingMenu, 0); },
    });
    openMenu("subs", "Subtitles", items, true);
  }
  (function initSubs() {
    var list = [];
    var one = q.get("sub");
    if (one) list.push({ url: one, label: "Subtitles", lang: "en" });
    var many = q.get("subs");
    if (many) {
      try {
        var arr = JSON.parse(many);
        if (Array.isArray(arr)) arr.forEach(function (s) {
          if (s && typeof s.url === "string" && s.url) list.push({ url: s.url, label: s.label, lang: s.lang });
        });
      } catch (e) {}
    }
    list.forEach(function (s, i) { addTrack(s.url, s.label, s.lang, i); });
  })();

  /* ── source loading (hls.js / native) ─────────────────────────────── */
  var hls = null, netErrors = 0, mediaErrors = 0, firstLoad = true;
  var isHls = (function () {
    var t = q.get("type");
    if (t) return t === "hls";
    return /\.m3u8|__sbproxy/i.test(SRC) && !/\.mp4(\?|$)/i.test(SRC);
  })();

  function showError(msg) {
    setLoading(false);
    ui.errMsg.textContent = msg || "This video couldn't be played.";
    cls("has-error", 1);
    showUI(true);
    if (kbMode) focusEl(ui.retry);
  }
  function clearError() { cls("has-error", 0); }

  function load(at) {
    clearError();
    setLoading(true);
    if (!SRC) return showError("No video source.");
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    netErrors = 0; mediaErrors = 0;
    if (isHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({
        autoStartLoad: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        backBufferLength: 30,
        enableWorker: true,
      });
      hls.loadSource(SRC);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        // preferred quality (height) from last time, else best
        var prefH = prefGet(PREF_QUALITY);
        var start = hls.levels.length - 1;
        if (typeof prefH === "number" && prefH > 0) {
          var bestIdx = -1, bestH = 0;
          hls.levels.forEach(function (l, i) {
            var h = l.height || 0;
            if (h <= prefH && h >= bestH) { bestH = h; bestIdx = i; }
          });
          if (bestIdx >= 0) start = bestIdx;
        }
        hls.startLevel = start;
        hls.startLoad(at > 0 ? at : -1);
        if (typeof prefH === "number" && prefH > 0) { hls.currentLevel = start; updateQualityLabel(); } // keep the chosen quality
        buildLevels();
        play();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, updateQualityLabel);
      hls.on(Hls.Events.FRAG_LOADED, function () { netErrors = 0; });
      hls.on(Hls.Events.ERROR, function (_, d) {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
          var code = (d.response && d.response.code) || 0;
          var manifest = d.details === "manifestLoadError" || d.details === "manifestLoadTimeOut";
          if (manifest && code >= 400 && code < 500) return showError("This video isn't available (HTTP " + code + ").");
          if (++netErrors > 4 || (manifest && netErrors > 2)) {
            return showError("Network error. Check your connection and try again.");
          }
          var h = hls;
          setTimeout(function () {
            if (hls !== h) return;
            if (manifest) h.loadSource(SRC); else h.startLoad();
          }, 500 * netErrors);
        } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          mediaErrors++;
          if (mediaErrors === 1) hls.recoverMediaError();
          else if (mediaErrors === 2) { hls.swapAudioCodec(); hls.recoverMediaError(); }
          else showError("This video format isn't supported on this device.");
        } else showError("Playback failed (" + (d.details || "error") + ").");
      });
    } else {
      ui.quality.hidden = true;
      video.src = SRC;
      if (at > 0) video.addEventListener("loadedmetadata", function () { video.currentTime = at; }, { once: true });
      video.load();
      play();
    }
  }
  video.addEventListener("error", function () {
    if (hls) return; // hls.js reports its own errors
    var c = video.error && video.error.code;
    showError(c === 4 ? "This file can't be played." : c === 2 ? "Network error while loading the video." : "Playback failed.");
  });
  function retry() {
    var t = video.currentTime > 0 ? video.currentTime : START;
    if (!hls) { video.removeAttribute("src"); }
    load(t);
  }

  /* quality */
  var levelOptions = []; // { idx, height, label }
  function buildLevels() {
    var seen = {};
    levelOptions = [];
    hls.levels.forEach(function (l, i) {
      var h = l.height || 0;
      var k = h || "b" + l.bitrate;
      if (seen[k] != null) { // keep the highest bitrate per height
        if (l.bitrate > hls.levels[levelOptions[seen[k]].idx].bitrate) levelOptions[seen[k]].idx = i;
        return;
      }
      seen[k] = levelOptions.length;
      levelOptions.push({ idx: i, height: h, label: h ? h + "p" : Math.round(l.bitrate / 1000) + " kbps", bitrate: l.bitrate });
    });
    levelOptions.sort(function (a, b) { return b.height - a.height || b.bitrate - a.bitrate; });
    ui.quality.hidden = levelOptions.length < 2;
    updateQualityLabel();
  }
  function levelLabel(i) {
    var l = hls && hls.levels[i];
    return l ? (l.height ? l.height + "p" : Math.round(l.bitrate / 1000) + "k") : "";
  }
  function updateQualityLabel() {
    if (!hls) return;
    var auto = hls.autoLevelEnabled || hls.manualLevel === -1;
    var cur = levelLabel(hls.currentLevel);
    ui.quality.textContent = auto ? (cur ? "Auto · " + cur : "Auto") : cur || "Auto";
  }
  function openQualityMenu() {
    if (!hls) return;
    var manual = hls.manualLevel;
    var auto = manual === -1;
    var items = [{
      label: "Auto", sub: auto ? levelLabel(hls.currentLevel) : "", sel: auto,
      run: function () { hls.currentLevel = -1; hls.nextLevel = -1; prefSet(PREF_QUALITY, "auto"); updateQualityLabel(); },
    }];
    levelOptions.forEach(function (o) {
      var l = hls.levels[o.idx];
      items.push({
        label: o.label, sub: l.bitrate ? (l.bitrate / 1e6).toFixed(1) + " Mbps" : "",
        sel: !auto && manual === o.idx,
        run: function () { hls.currentLevel = o.idx; prefSet(PREF_QUALITY, l.height || 0); updateQualityLabel(); },
      });
    });
    openMenu("quality", "Quality", items);
  }

  /* ── gestures ─────────────────────────────────────────────────────── */
  var W = window.innerWidth, H = window.innerHeight;
  window.addEventListener("resize", function () { W = window.innerWidth; H = window.innerHeight; }, { passive: true });

  var g = null; // active gesture
  var lastTap = { t: 0, x: 0, y: 0 };
  var tapTimer = 0;
  var seekStreak = { side: 0, total: 0, until: 0, timer: 0 };
  var TAP_SLOP = 12, DOUBLE_MS = 300;

  function zoneOf(x) { return x < W / 3 ? -1 : x > (W * 2) / 3 ? 1 : 0; }

  root.addEventListener("pointerdown", function (e) {
    if (e.button && e.button !== 0) return;
    if (menuOpen) { closeMenu(); g = { dead: true }; return; }
    if (root.classList.contains("has-error")) return;
    if (g && !g.dead && g.id !== e.pointerId) { g.dead = true; return; } // second finger cancels
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), mode: "", dead: false };
    try { root.setPointerCapture(e.pointerId); } catch (x) {}
  }, { passive: true });

  root.addEventListener("pointermove", function (e) {
    if (!g || g.dead || e.pointerId !== g.id) return;
    g.x = e.clientX; g.y = e.clientY;
    var dx = g.x - g.x0, dy = g.y - g.y0;
    if (!g.mode) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (!dur()) { g.dead = true; return; }
        g.mode = "scrub"; g.base = video.currentTime; g.target = g.base;
        clearTimeout(tapTimer); ui.scrub.classList.add("on");
      } else {
        // ignore vertical swipes from the very top/bottom edges (system gestures)
        if (g.y0 < 24 || g.y0 > H - 24) { g.dead = true; return; }
        g.mode = g.x0 < W / 2 ? "bright" : "vol";
        if (g.mode === "bright" && !FRAMED) { g.dead = true; return; }
        if (!FRAMED) levels.volume = video.muted ? 0 : video.volume;
        g.base = g.mode === "bright" ? levels.brightness : levels.volume;
        g.x0 = g.x; g.y0 = g.y; dy = 0; dx = 0; // start from the threshold point, no jump
        clearTimeout(tapTimer);
        showLevel(g.mode, g.base);
      }
    }
    if (!g.raf) g.raf = requestAnimationFrame(gestureFrame);
  }, { passive: true });

  function gestureFrame() {
    if (!g) return;
    g.raf = 0;
    var dx = g.x - g.x0, dy = g.y - g.y0;
    if (g.mode === "scrub") {
      var d = dur();
      var span = Math.min(d, Math.max(90, Math.min(d * 0.25, 300))); // full width ≈ 1.5–5 min
      g.target = clamp(g.base + (dx / W) * span, 0, d);
      var delta = Math.round(g.target - g.base);
      ui.scrubTime.textContent = fmt(g.target);
      ui.scrubDelta.textContent = (delta >= 0 ? "+" : "−") + fmt(Math.abs(delta));
      dragTime = g.target; dragging = true; schedule(); // preview on the seek bar too
    } else if (g.mode === "bright" || g.mode === "vol") {
      var v = clamp(g.base - dy / (H * 0.7), 0, 1);
      setLevel(g.mode, v);
    }
  }

  function endGesture(e, cancelled) {
    if (!g || e.pointerId !== g.id) return;
    var cur = g; g = null;
    if (cur.raf) cancelAnimationFrame(cur.raf);
    if (cur.dead) return;
    if (cur.mode === "scrub") {
      gestureFrameFinal(cur);
      ui.scrub.classList.remove("on");
      dragging = false;
      if (!cancelled) seekTo(cur.target);
      showUI();
      return;
    }
    if (cur.mode) { hideLevelSoon(); return; }
    if (cancelled) return;
    handleTap(cur.x0, cur.y0);
  }
  function gestureFrameFinal(cur) { g = cur; gestureFrame(); g = null; }
  root.addEventListener("pointerup", function (e) { endGesture(e, false); }, { passive: true });
  root.addEventListener("pointercancel", function (e) { endGesture(e, true); }, { passive: true });

  function handleTap(x, y) {
    var now = performance.now();
    var zone = zoneOf(x);
    // In an active seek streak, single taps on the same side keep adding.
    if (zone !== 0 && seekStreak.side === zone && now < seekStreak.until) {
      lastTap.t = 0;
      return doubleTapSeek(zone, x, y);
    }
    var isDouble = now - lastTap.t < DOUBLE_MS && Math.abs(x - lastTap.x) < 60 && Math.abs(y - lastTap.y) < 60;
    if (isDouble) {
      clearTimeout(tapTimer);
      lastTap.t = 0;
      if (zone === 0) { togglePlay(); return; }
      return doubleTapSeek(zone, x, y);
    }
    lastTap = { t: now, x: x, y: y };
    clearTimeout(tapTimer);
    // Centre taps act immediately (no double-tap seek there); sides wait to rule out a double tap.
    tapTimer = setTimeout(toggleUI, zone === 0 && !uiShown ? 0 : DOUBLE_MS);
  }

  function doubleTapSeek(side, x, y) {
    if (!dur()) return;
    if (seekStreak.side !== side || performance.now() > seekStreak.until) seekStreak.total = 0;
    seekStreak.side = side;
    seekStreak.total += SEEK_STEP;
    seekStreak.until = performance.now() + 700;
    seekBy(side * SEEK_STEP);
    var rip = side < 0 ? ui.rippleL : ui.rippleR, other = side < 0 ? ui.rippleR : ui.rippleL;
    other.classList.remove("on");
    rip.classList.add("on");
    var wave = rip.firstElementChild;
    var rx = side < 0 ? x : x - (W - rip.offsetWidth);
    wave.style.left = rx + "px"; wave.style.top = y + "px";
    wave.classList.remove("go"); void wave.offsetWidth; wave.classList.add("go");
    var bub = rip.querySelector(".bubble");
    bub.lastElementChild.textContent = (side < 0 ? "−" : "+") + seekStreak.total + "s";
    bub.classList.remove("pop"); void bub.offsetWidth; bub.classList.add("pop");
    clearTimeout(seekStreak.timer);
    seekStreak.timer = setTimeout(function () { rip.classList.remove("on"); }, 750);
  }

  /* ── brightness / volume (native via host) ────────────────────────── */
  var levels = { brightness: 0.5, volume: video.volume };
  var ICON_SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
  var ICON_VOL = '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  var ICON_MUTE = '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>';
  var levelHideT = 0, levelKind = "", levelIconKey = "", postT = 0, postPending = null;

  function showLevel(kind, v) {
    clearTimeout(levelHideT);
    if (levelKind !== kind) {
      levelKind = kind;
      ui.level.classList.toggle("left", kind === "bright");
      ui.level.classList.toggle("right", kind !== "bright");
    }
    paintLevel(kind, v);
    ui.level.classList.add("on");
  }
  function paintLevel(kind, v) {
    ui.levelFill.style.transform = "scaleY(" + v + ")";
    ui.levelPct.textContent = Math.round(v * 100);
    var ik = kind === "bright" ? "sun" : v <= 0.001 ? "mute" : "vol";
    if (ik !== levelIconKey) { levelIconKey = ik; ui.levelIcon.innerHTML = ik === "sun" ? ICON_SUN : ik === "mute" ? ICON_MUTE : ICON_VOL; }
  }
  function hideLevelSoon() {
    clearTimeout(levelHideT);
    levelHideT = setTimeout(function () { ui.level.classList.remove("on"); }, 700);
  }
  function setLevel(kind, v) {
    if (kind === "bright") levels.brightness = v; else levels.volume = v;
    paintLevel(kind, v);
    if (kind === "vol" && !FRAMED) { video.volume = v; video.muted = v === 0; return; }
    // throttle native calls to ~30/s, always sending the final value
    postPending = { cmd: kind === "bright" ? "brightness" : "volume", value: Math.round(v * 1000) / 1000 };
    if (!postT) {
      post(postPending); postPending = null;
      postT = setTimeout(function flush() {
        postT = 0;
        if (postPending) { post(postPending); postPending = null; postT = setTimeout(flush, 33); }
      }, 33);
    }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object" || d.__sb !== "playerLevels") return;
    if (FRAMED && e.source !== window.parent) return;
    if (typeof d.brightness === "number" && isFinite(d.brightness)) levels.brightness = clamp(d.brightness, 0, 1);
    if (typeof d.volume === "number" && isFinite(d.volume)) levels.volume = clamp(d.volume, 0, 1);
  });
  if (FRAMED) post({ cmd: "getLevels" });

  /* ── keyboard / TV remote ─────────────────────────────────────────── */
  var kbMode = false, kbEl = null;
  function focusables() {
    var scope = menuOpen ? ui.menuList : root.classList.contains("has-error") ? ui.err : root;
    var els = scope.querySelectorAll(menuOpen ? ".menu-item" : "button.ctl, .seek");
    return Array.prototype.filter.call(els, function (el) {
      if (el.hidden || el.closest("[hidden]")) return false;
      if (!menuOpen && el.closest(".menu")) return false;
      return el.offsetParent !== null;
    });
  }
  function clearKbFocus() { if (kbEl) kbEl.classList.remove("kb-focus"); kbEl = null; }
  function focusEl(el) {
    if (!el) return;
    clearKbFocus();
    kbEl = el;
    el.classList.add("kb-focus");
    try { el.focus({ preventScroll: true }); } catch (e) {}
  }
  function moveFocus(dir) {
    var list = focusables();
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    if (i < 0) i = dir > 0 ? -1 : list.indexOf(ui.play) + 1 || list.length;
    focusEl(list[(i + dir + list.length) % list.length]);
  }
  document.addEventListener("pointerdown", function () { if (kbMode) { kbMode = false; clearKbFocus(); } }, { passive: true, capture: true });

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    var a = document.activeElement;
    var onButton = a && a.tagName === "BUTTON" && root.contains(a);
    var wasHidden = !uiShown;
    switch (k) {
      case " ": case "Spacebar": case "Enter": case "OK": case "Select":
        kbMode = true;
        if (onButton && !wasHidden) { showUI(); return; } // native button activation
        e.preventDefault();
        togglePlay();
        showUI();
        return;
      case "MediaPlayPause": case "MediaPlay": case "MediaPause": case "Play": case "Pause":
        e.preventDefault();
        if (k === "MediaPlay" || k === "Play") play();
        else if (k === "MediaPause" || k === "Pause") video.pause();
        else togglePlay();
        showUI();
        return;
      case "ArrowLeft": case "Left": case "MediaRewind": case "MediaTrackPrevious":
        e.preventDefault(); kbMode = true;
        if (menuOpen) return;
        seekBy(-SEEK_STEP); showUI();
        return;
      case "ArrowRight": case "Right": case "MediaFastForward": case "MediaTrackNext":
        e.preventDefault(); kbMode = true;
        if (menuOpen) return;
        seekBy(SEEK_STEP); showUI();
        return;
      case "ArrowUp": case "Up": case "ArrowDown": case "Down":
        e.preventDefault(); kbMode = true;
        showUI();
        if (wasHidden && !menuOpen) { focusEl(root.classList.contains("has-error") ? ui.retry : ui.play); return; }
        moveFocus(k === "ArrowDown" || k === "Down" ? 1 : -1);
        return;
      case "Escape": case "Esc": case "GoBack": case "BrowserBack":
        if (menuOpen) { e.preventDefault(); closeMenu(); return; }
        if (CAN_CLOSE) { e.preventDefault(); closePlayer(); }
        return;
      case "m": case "M":
        if (!FRAMED) video.muted = !video.muted;
        return;
    }
  });

  /* ── resume reporting ─────────────────────────────────────────────── */
  var lastReported = -1;
  function reportPosition() {
    var t = video.currentTime || 0;
    if (!(t > 0)) return;
    lastReported = t;
    post({ cmd: "position", t: t, d: dur(), key: KEY });
  }
  setInterval(function () { if (!video.paused && !video.ended && video.currentTime !== lastReported) reportPosition(); }, 5000);
  window.addEventListener("pagehide", reportPosition);
  document.addEventListener("visibilitychange", function () { if (document.hidden) reportPosition(); });

  /* ── go ───────────────────────────────────────────────────────────── */
  syncPlay();
  showUI(true);
  load(START);
  try { root.focus({ preventScroll: true }); } catch (e) {}
})();
