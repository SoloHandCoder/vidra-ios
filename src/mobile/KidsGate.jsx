// Wraps the Settings page: in a kids profile it opens only after the parent PIN.
import { useEffect, useState } from "react";
import { askParentPin, currentProfileInfo, hasParentPin, isKidsProfile } from "./kids.js";

export default function KidsGate({ children, onDenied }) {
  const p = currentProfileInfo();
  const flag = `__sb_kids_ok_${p?.id}`;
  const [ok, setOk] = useState(() => !isKidsProfile() || !hasParentPin() || sessionStorage.getItem(flag) === "1");
  useEffect(() => {
    if (ok) return;
    askParentPin("Settings are locked in a kids profile.").then((r) => {
      if (r) {
        sessionStorage.setItem(flag, "1");
        setOk(true);
      } else onDenied?.();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ok ? children : null;
}
