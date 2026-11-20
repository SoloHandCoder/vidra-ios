// Drop-in replacement for Electron's <webview> tag, built on an <iframe>.
// The ref is the iframe element itself, extended with the <webview> methods the
// app uses: executeJavaScript(), getWebContentsId(); and the events
// "dom-ready" / "did-finish-load" / "did-fail-load" are dispatched on it.
// executeJavaScript talks to the bridge that the native layer injects into every
// frame (android/app/src/main/assets/sb-inject.js).
import { forwardRef, useCallback, useEffect, useRef } from "react";

let seq = 0;
const pending = new Map();
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.__sb !== "result") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    clearTimeout(p.timer);
    if (d.ok) p.resolve(d.value);
    else p.reject(new Error(d.error || "executeJavaScript failed"));
  });
}

const frameRegistry = new Map();
let frameSeq = 1;

/** Runs code in the iframe's document (deep = also search nested frames for a non-null result). */
export function execInFrame(iframe, code, { deep = false, timeout = 2500 } = {}) {
  ensureListener();
  return new Promise((resolve, reject) => {
    const win = iframe?.contentWindow;
    if (!win) return reject(new Error("webview not ready"));
    const id = "m" + ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("executeJavaScript timeout"));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    try {
      win.postMessage({ __sb: "exec", id, code: String(code), deep }, "*");
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}

export function frameById(id) {
  return frameRegistry.get(id) || null;
}

const MobileWebView = forwardRef(function MobileWebView(props, ref) {
  const {
    src,
    style,
    className,
    // Electron-only attributes, ignored on Android
    partition, // eslint-disable-line no-unused-vars
    useragent, // eslint-disable-line no-unused-vars
    allowpopups, // eslint-disable-line no-unused-vars
    sandbox, // eslint-disable-line no-unused-vars
    webpreferences, // eslint-disable-line no-unused-vars
    preload, // eslint-disable-line no-unused-vars
    ...rest
  } = props;
  const elRef = useRef(null);
  const idRef = useRef(frameSeq++);

  const setRef = useCallback(
    (el) => {
      elRef.current = el;
      if (el && !el.__sbPatched) {
        el.__sbPatched = true;
        el.executeJavaScript = (code) => execInFrame(el, code);
        el.getWebContentsId = () => idRef.current;
        el.getURL = () => el.getAttribute("src") || "";
        el.reload = () => {
          const s = el.getAttribute("src");
          el.setAttribute("src", "about:blank");
          setTimeout(() => el.setAttribute("src", s), 30);
        };
        el.insertCSS = () => Promise.resolve();
        frameRegistry.set(idRef.current, el);
      }
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onLoad = () => {
      el.dispatchEvent(new Event("dom-ready"));
      el.dispatchEvent(new Event("did-finish-load"));
    };
    const onError = () => el.dispatchEvent(new Event("did-fail-load"));
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
    // embed hosts that never fire load (blocked) → don't keep the loader forever
    const failsafe = setTimeout(() => el.dispatchEvent(new Event("did-finish-load")), 15000);
    return () => {
      clearTimeout(failsafe);
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
    };
  }, [src]);

  useEffect(() => {
    const id = idRef.current;
    return () => frameRegistry.delete(id);
  }, []);

  return (
    <iframe
      ref={setRef}
      src={src || "about:blank"}
      style={{ border: "none", background: "#000", ...style }}
      className={className}
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
      allowFullScreen
      referrerPolicy="origin"
      {...rest}
    />
  );
});

export default MobileWebView;

/** All mounted MobileWebView iframes (most recently mounted last). */
export function allFrames() {
  return [...frameRegistry.values()].filter((el) => el.isConnected);
}
