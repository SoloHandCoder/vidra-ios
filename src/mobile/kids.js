// Kids profiles: a profile can be marked "Kids" with its own age limit. While
// a kids profile is active, leaving it (switching profile) and opening
// Settings need the parent PIN — on Android the phone's own screen lock /
// fingerprint works too. Only a salted SHA-256 hash of the PIN is stored.
import "./kids.css";
import { t } from "./i18n.js";

const META = "__sb_profiles";
const PIN = "__sb_parent_pin"; // { salt, hash }

function meta() {
  try {
    return JSON.parse(localStorage.getItem(META) || "null");
  } catch {
    return null;
  }
}
export function currentProfileInfo() {
  const m = meta();
  return m?.list?.find((p) => p.id === m.current) || null;
}
export const isKidsProfile = (p = currentProfileInfo()) => !!p?.kids;
/** the age limit of a kids profile (null when none) */
export function kidsAgeLimit() {
  const p = currentProfileInfo();
  return p?.kids ? Number(p.ageLimit ?? 12) : null;
}

async function hash(pin, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const hasParentPin = () => {
  try {
    return !!JSON.parse(localStorage.getItem(PIN) || "null")?.hash;
  } catch {
    return false;
  }
};
export async function setParentPin(pin) {
  const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
  localStorage.setItem(PIN, JSON.stringify({ salt, hash: await hash(pin, salt) }));
}
async function checkParentPin(pin) {
  try {
    const p = JSON.parse(localStorage.getItem(PIN) || "null");
    return !!p?.hash && (await hash(pin, p.salt)) === p.hash;
  } catch {
    return false;
  }
}

/** asks for the parent PIN; resolves true when it was right */
export function askParentPin(reason = "") {
  if (!hasParentPin()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "sbk-lock";
    el.innerHTML = `<div class="sbk-box" role="dialog">
        <div class="sbk-icon" aria-hidden="true">🔒</div>
        <div class="sbk-title"></div>
        <div class="sbk-reason"></div>
        <input class="sbk-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" />
        <div class="sbk-msg"></div>
        <div class="sbk-btns">
          <button type="button" class="btn btn-ghost sbk-cancel"></button>
          <button type="button" class="btn btn-primary sbk-ok"></button>
        </div>
        <button type="button" class="sbx-link sbk-device" hidden></button>
      </div>`;
    el.querySelector(".sbk-title").textContent = t("Parent PIN");
    el.querySelector(".sbk-reason").textContent = reason ? t(reason) : "";
    el.querySelector(".sbk-cancel").textContent = t("Cancel");
    el.querySelector(".sbk-ok").textContent = t("Unlock");
    const input = el.querySelector("input");
    const msg = el.querySelector(".sbk-msg");
    let tries = 0;
    const done = (ok) => {
      el.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(ok);
    };
    const attempt = async () => {
      if (!input.value) return;
      if (await checkParentPin(input.value)) return done(true);
      tries++;
      input.value = "";
      msg.textContent = t("Wrong PIN");
      const box = el.querySelector(".sbk-box");
      box.classList.remove("shake");
      void box.offsetWidth;
      box.classList.add("shake");
      if (tries >= 5) {
        input.disabled = true;
        setTimeout(() => {
          input.disabled = false;
          input.focus();
        }, 15000);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    input.addEventListener("keydown", (e) => e.key === "Enter" && attempt());
    el.querySelector(".sbk-ok").onclick = attempt;
    el.querySelector(".sbk-cancel").onclick = () => done(false);
    // Android: the phone's own lock (fingerprint / PIN) works as well
    const dev = el.querySelector(".sbk-device");
    if (window.electron?.verifyUser) {
      dev.hidden = false;
      dev.textContent = t("Use phone screen lock");
      dev.onclick = async () => {
        if (await window.electron.verifyUser(t("Parent PIN")).catch(() => false)) done(true);
      };
    }
    // Android back button cancels
    const prevBack = window.__sbSheetBack;
    window.__sbSheetBack = () => {
      window.__sbSheetBack = prevBack;
      done(false);
      return true;
    };
    document.body.appendChild(el);
    setTimeout(() => input.focus(), 50);
  });
}

/** run fn only if allowed: outside a kids profile always, inside it after the PIN */
export async function guardKids(reason, fn) {
  if (isKidsProfile() && !(await askParentPin(reason))) return false;
  await fn?.();
  return true;
}
