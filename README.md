# Vidra iOS

iOS app based on [Streambert](https://github.com/truelockmc/streambert): the same app as [Vidra Android](https://github.com/SoloHandCoder/vidra-android), built for iPhone and iPad.

## Install
Each [release](https://github.com/SoloHandCoder/vidra-ios/releases) has an **unsigned `.ipa`**. Install it with a sideloading tool that signs it with your own Apple ID:
- [AltStore](https://altstore.io) / [SideStore](https://sidestore.io) on the iPhone, or
- [Sideloadly](https://sideloadly.io) from a computer.

With a free Apple ID, apps have to be re-signed every 7 days (AltStore and SideStore can do this automatically).

**Updates:** Settings → Updates checks this repo's releases. iOS can't install apps from inside another app, so "Install" opens the release page. Install the new `.ipa` the same way as the first one; your data is kept.

## What's in the iOS version
Everything from the Android app that runs in the web layer: Home, Search, Discover, people pages, library and history, ratings and lists, subtitles, trailers, profiles and kids profiles, cloud sync, Trakt, the watch party (with invite links: `vidra://party/CODE`), stats card, episode reminders (local notifications), and the app language.

**Not in the iOS version yet:** downloads, Chromecast, home-screen widgets, background new-episode checks, and voice search. Picture-in-picture and fullscreen use iOS's own video player.

## How it works
- **UI**: the shared React app (`src/`), the same as on Android.
- **`window.electron` shim** (`src/mobile/electronShim.js`) maps the desktop preload API to the native plugin.
- **Native layer** (`ios/App/App/`):
  - `StreambertPlugin.swift`: the app's Capacitor plugin (still registered under its original name, `Streambert`). It covers native HTTP (no CORS), files, notifications and reminders, sharing, Face ID app lock, keep-screen-on and brightness, cache and cookies, links opened with the app, and updates.
  - **Frame script**: `public/native/sb-inject.js` is injected into every frame (WKUserScript), the same bridge as on Android. It provides `executeJavaScript` for embedded players and stubs pop-ups.
  - **Ad blocking**: the shared block list (`public/native/sb-blocklist.txt`) is compiled into a WebKit content blocker.
  - **Navigation**: embedded players can't navigate the whole app away to ad pages.
  - `MainViewController.swift` registers the plugin.

## Build
GitHub Actions (`.github/workflows/ios.yml`) builds an unsigned `.ipa` on every push; the file is in the run's artifacts. Pushing a tag `vX.Y.Z-ios` also publishes a release with the `.ipa`. Release notes come from `release-notes/<tag>.md`, if that file exists.

Local build (needs a Mac with Xcode 16 and CocoaPods):
```
npm install
npm run build
npx cap sync ios
open ios/App/App.xcworkspace
```

## License
GPL-3.0, like Streambert.
