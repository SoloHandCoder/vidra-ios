// Android TV / D-pad / keyboard arrow navigation, reusing the desktop's
// controller spatial navigation (utils/gamepadSpatialNav.js).
import {
  moveGamepadFocus,
  confirmGamepadFocus,
  ensureInitialFocus,
  getGamepadFocus,
} from "../utils/gamepadSpatialNav";
import { native, isNative } from "./native.js";

const DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

function isTextField(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "range"].includes(t);
  }
  return el.isContentEditable;
}

export function initTvNav() {
  if (!isNative) return;
  native.plugin
    .getDeviceInfo()
    .then((info) => {
      if (info?.tv) {
        document.documentElement.setAttribute("data-tv", "1");
        ensureInitialFocus();
      }
    })
    .catch(() => {});

  window.addEventListener(
    "keydown",
    (e) => {
      // inside an iframe player the frame handles its own keys
      if (document.activeElement?.tagName === "IFRAME") return;
      const dir = DIRS[e.key];
      const active = document.activeElement;
      if (dir) {
        // let text fields move their caret left/right
        if (isTextField(active) && (dir === "left" || dir === "right")) return;
        if (active?.tagName === "SELECT") return;
        e.preventDefault();
        document.documentElement.setAttribute("data-keynav", "1");
        ensureInitialFocus();
        moveGamepadFocus(dir);
        return;
      }
      if ((e.key === "Enter" || e.key === " " || e.key === "DPadCenter") && !isTextField(active)) {
        const f = getGamepadFocus();
        // native buttons/links already activate on Enter; cards (divs) need a click
        if (f && f === active && /^(BUTTON|A|INPUT|SELECT)$/.test(f.tagName)) return;
        if (f) {
          e.preventDefault();
          confirmGamepadFocus();
        }
      }
    },
    true,
  );
  // touch/mouse use hides the keyboard focus ring again
  window.addEventListener(
    "pointerdown",
    () => document.documentElement.removeAttribute("data-keynav"),
    { passive: true, capture: true },
  );
}
