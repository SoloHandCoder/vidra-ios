import "./mobile/electronShim.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import "./styles/mobile.css";
import { initTvNav } from "./mobile/tvNav.js";
import { initPullToRefresh } from "./mobile/pullToRefresh.js";
import { initIncoming } from "./mobile/incoming.js";
import { initEpisodeWatch } from "./mobile/episodeWatch.js";
import { initProfiles } from "./mobile/profiles.js";
import { initWidgetSync } from "./mobile/widgetSync.js";
import { initCloudSync } from "./mobile/cloudSync.js";
import { initI18n } from "./mobile/i18n.js";
import { initMotion } from "./mobile/motion.js";
import { initPeople } from "./mobile/people.js";
import { initReminders } from "./mobile/reminders.js";

initI18n();
initMotion();
initTvNav();
if (window.electron?.isMobile) {
  initPullToRefresh();
  initIncoming();
  initEpisodeWatch();
  initProfiles();
  initWidgetSync();
  initCloudSync();
  const tmdbKey = async () => localStorage.getItem("__secure_apikey") || "";
  initPeople(tmdbKey);
  initReminders(tmdbKey);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
