// Pull-to-refresh on the Home page (mobile only).
// Drag down while the page is scrolled to the top → red refresh badge follows
// the finger; release past the threshold → window.__sbNav.refreshHome().

const THRESHOLD = 72; // px of (damped) pull needed
const MAX = 110;

export function initPullToRefresh() {
  const el = document.createElement("div");
  el.className = "sb-ptr";
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  document.body.appendChild(el);

  let startY = 0, startX = 0, pull = 0, tracking = false, decided = false, refreshing = false;

  const main = () => document.querySelector(".main");
  const eligible = () =>
    window.__sbNav?.page?.() === "home" &&
    !document.querySelector(".modal-overlay, .trailer-overlay, iframe[data-sb-local-player]") &&
    (main()?.scrollTop ?? 1) <= 0;

  const render = () => {
    const y = Math.min(pull, MAX);
    const p = Math.min(1, y / THRESHOLD);
    el.style.transform = `translate(-50%, ${y - 56}px) rotate(${p * 270}deg)`;
    el.style.opacity = String(Math.min(1, p * 1.4));
    el.classList.toggle("sb-ptr--ready", p >= 1);
  };
  const reset = () => {
    pull = 0;
    el.style.transition = "transform .25s ease, opacity .25s ease";
    render();
    setTimeout(() => (el.style.transition = ""), 260);
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (refreshing || e.touches.length !== 1 || !eligible()) return;
      tracking = true;
      decided = false;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pull = 0;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true;
        // horizontal swipes (carousels) and upward scrolls are not a pull
        if (Math.abs(dx) > Math.abs(dy) || dy < 0 || (main()?.scrollTop ?? 1) > 0) {
          tracking = false;
          return;
        }
      }
      pull = Math.max(0, dy) * 0.5;
      if (pull > 0 && e.cancelable) e.preventDefault();
      render();
    },
    { passive: false },
  );

  const end = async () => {
    if (!tracking) return;
    tracking = false;
    if (pull < THRESHOLD) return reset();
    refreshing = true;
    pull = THRESHOLD;
    el.style.transition = "transform .2s ease";
    render();
    el.classList.add("sb-ptr--spin");
    try { navigator.vibrate?.(12); } catch {}
    const started = Date.now();
    try { window.__sbNav?.refreshHome?.(); } catch {}
    // keep the spinner up briefly so the refresh is noticeable
    await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - started))));
    el.classList.remove("sb-ptr--spin");
    refreshing = false;
    reset();
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
}
