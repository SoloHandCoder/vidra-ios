// Poster images fade in once they've loaded (instead of popping in), with a
// shimmer placeholder while loading. Images that are already loaded are left
// alone; a failed image is shown as-is.
import "./motion.css";

const SEL = ".card-poster img, .sbu-poster img, .history-thumb img, .saved-thumb img, .detail-poster img, .sbx-recap-top img";

function watch(img) {
  if (img.dataset.sbMotion) return;
  img.dataset.sbMotion = "1";
  if (img.complete && img.naturalWidth > 0) return;
  img.classList.add("sb-img-pending");
  const done = () => {
    img.classList.remove("sb-img-pending");
    img.classList.add("sb-img-in");
  };
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
  // never leave an image hidden
  setTimeout(() => img.classList.remove("sb-img-pending"), 8000);
}

function scan(root) {
  if (root.matches?.(SEL)) watch(root);
  root.querySelectorAll?.(SEL).forEach(watch);
}

export function initMotion() {
  const start = () => {
    scan(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
