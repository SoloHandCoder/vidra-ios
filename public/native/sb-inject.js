// Injected at document start into EVERY frame (androidx.webkit DOCUMENT_START_SCRIPT).
// In the app's own top frame it does nothing. In embedded player frames it:
//  - provides an executeJavaScript bridge (the desktop <webview>.executeJavaScript
//    and per-frame "query-video-progress" equivalent) via postMessage,
//  - stubs window.open (popup ads; some players require a non-null result),
//  - applies the desktop's per-site CSS tweaks.
(function () {
  try {
    if (window.__sbInjected) return;
    window.__sbInjected = true;
    var isAppTop =
      window.top === window && location.hostname === "localhost";
    if (isAppTop) return;

    // ── popup stub ────────────────────────────────────────────────────────
    var fakeWin = function () {
      var w = {
        closed: false,
        close: function () { w.closed = true; },
        focus: function () {},
        blur: function () {},
        postMessage: function () {},
        document: { write: function () {}, open: function () {}, close: function () {} },
        location: { href: "about:blank", replace: function () {}, assign: function () {} },
      };
      setTimeout(function () { w.closed = true; }, 5000);
      return w;
    };
    try {
      Object.defineProperty(window, "open", {
        value: function () { return fakeWin(); },
        writable: false,
        configurable: false,
      });
    } catch (e) {
      window.open = function () { return fakeWin(); };
    }

    // ── exec bridge ───────────────────────────────────────────────────────
    var pending = {};
    var seq = 0;
    function isUseful(v) {
      return v !== null && v !== undefined && v !== false && v !== "";
    }
    function evalLocal(code) {
      try {
        // indirect eval → global scope
        return Promise.resolve((0, eval)(code));
      } catch (e) {
        try {
          return Promise.resolve(Function('"use strict";return (' + code + ")")());
        } catch (e2) {
          return Promise.reject(e);
        }
      }
    }
    function askChildren(code) {
      var frames = [];
      try {
        for (var i = 0; i < window.frames.length; i++) frames.push(window.frames[i]);
      } catch (e) {}
      if (!frames.length) return Promise.resolve(null);
      return new Promise(function (resolve) {
        var left = frames.length;
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; resolve(null); }
        }, 1200);
        frames.forEach(function (f) {
          var id = "c" + ++seq + "_" + Math.random().toString(36).slice(2);
          pending[id] = function (ok, value) {
            delete pending[id];
            left--;
            if (done) return;
            if (ok && isUseful(value)) {
              done = true; clearTimeout(timer); resolve(value);
            } else if (left <= 0) {
              done = true; clearTimeout(timer); resolve(null);
            }
          };
          try {
            f.postMessage({ __sb: "exec", id: id, code: code, deep: true }, "*");
          } catch (e) {
            pending[id](false, null);
          }
        });
      });
    }
    function safeClone(v) {
      try {
        return JSON.parse(JSON.stringify(v === undefined ? null : v));
      } catch (e) {
        return null;
      }
    }
    window.addEventListener(
      "message",
      function (ev) {
        var d = ev.data;
        if (!d || typeof d !== "object") return;
        if (d.__sb === "result" && pending[d.id]) {
          pending[d.id](d.ok, d.value);
          return;
        }
        if (d.__sb !== "exec" || typeof d.code !== "string") return;
        // only answer our parent chain
        if (ev.source !== window.parent) return;
        ev.stopImmediatePropagation();
        var reply = function (ok, value, error) {
          try {
            ev.source.postMessage(
              { __sb: "result", id: d.id, ok: ok, value: safeClone(value), error: error || null },
              "*",
            );
          } catch (e) {}
        };
        evalLocal(d.code).then(
          function (v) {
            if (d.deep && !isUseful(v)) {
              askChildren(d.code).then(function (cv) { reply(true, cv); });
            } else {
              reply(true, v);
            }
          },
          function (err) {
            if (d.deep) askChildren(d.code).then(function (cv) { reply(true, cv); });
            else reply(false, null, String((err && err.message) || err));
          },
        );
      },
      true,
    );

    // ── HLS playlist detection by content ────────────────────────────────
    // Many hosts serve playlists from URLs without ".m3u8" (e.g. /pl/<token>),
    // so the URL based capture misses them. Report any response that starts
    // with #EXTM3U to the app (top frame) with the page as referer.
    var reported = {};
    var sawMaster = false;
    function reportPlaylist(url, text) {
      try {
        if (!url || reported[url] || typeof text !== "string") return;
        if (text.slice(0, 16).indexOf("#EXTM3U") === -1) return;
        var isMaster = text.indexOf("#EXT-X-STREAM-INF") !== -1;
        if (isMaster) sawMaster = true;
        reported[url] = 1;
        var abs = new URL(url, location.href).href;
        window.top.postMessage(
          { __sb: "m3u8", url: abs, referer: location.href, origin: location.origin, master: isMaster },
          "*",
        );
      } catch (e) {}
    }
    try {
      var XO = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u) {
        this.__sbUrl = u;
        return XO.apply(this, arguments);
      };
      var XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function () {
        var x = this;
        x.addEventListener("load", function () {
          try {
            var t = null;
            if (x.responseType === "" || x.responseType === "text") t = x.responseText;
            else if (x.responseType === "arraybuffer" && x.response && x.response.byteLength < 2000000)
              t = new TextDecoder().decode(new Uint8Array(x.response, 0, Math.min(x.response.byteLength, 400000)));
            if (t) reportPlaylist(x.responseURL || x.__sbUrl, t);
          } catch (e) {}
        });
        return XS.apply(this, arguments);
      };
    } catch (e) {}
    try {
      var F = window.fetch;
      if (F) {
        window.fetch = function () {
          var p = F.apply(this, arguments);
          p.then(function (res) {
            try {
              var len = Number(res.headers.get("content-length") || 0);
              if (len > 2000000) return;
              var ct = res.headers.get("content-type") || "";
              if (/video\/|audio\/|image\/|font\//i.test(ct)) return;
              res.clone().text().then(function (t) { reportPlaylist(res.url, t); }, function () {});
            } catch (e) {}
          }, function () {});
          return p;
        };
      }
    } catch (e) {}

    // ── per-site CSS tweaks (desktop siteTweaks.js) ──────────────────────
    var host = location.hostname;
    var match = function (hs) {
      return hs.some(function (h) { return host === h || host.slice(-(h.length + 1)) === "." + h; });
    };
    var onlyEl = function (sel) {
      return "html,body{overflow:hidden!important;background:#000!important}" +
        "body *{visibility:hidden!important}" +
        sel + "," + sel + " *{visibility:visible!important}" +
        sel + "{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;margin:0!important;z-index:2147483647!important;background:#000!important;overflow:auto!important}";
    };
    var hide = function (sels) { return sels.join(",") + "{display:none!important}"; };
    var css = "";
    if (match(["on.kinohub.vip"])) css = onlyEl("section.player_section");
    else if (match(["aether.ist"]))
      css = hide([
        "div:has(> .top-content)", ".top-content",
        '[id="__overlayRouter::episodes"]', '[id="__overlayRouter::episodes"] + button',
        'a.tabbable[class*="cancelHover"]',
        'button.tabbable.p-2.rounded-full:has(> span.text-xl > svg[width="18"][height="18"])',
      ]);
    else if (match(["vidnest.fun"])) css = hide([".popup-selector", "#overlay-id"]);
    else if (match(["frembed.uno"])) css = hide([".popup-selector"]);
    if (css) {
      var add = function () {
        var s = document.createElement("style");
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      };
      if (document.documentElement) add();
      else document.addEventListener("DOMContentLoaded", add);
    }
  } catch (e) {}
})();
