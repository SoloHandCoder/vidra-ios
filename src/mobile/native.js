// Thin wrapper around the app's native Capacitor plugin (ios/App/App/StreambertPlugin.swift)
import { Capacitor, registerPlugin } from "@capacitor/core";

const Plugin = registerPlugin("Streambert");

export const isNative = Capacitor.isNativePlatform();

export const native = {
  plugin: Plugin,
  http: (opts) => Plugin.http(opts),
  writeFile: (opts) => Plugin.writeFile(opts),
  readFile: (opts) => Plugin.readFile(opts),
  deleteFile: (opts) => Plugin.deleteFile(opts),
  fileExists: (opts) => Plugin.fileExists(opts),
  getPaths: () => Plugin.getPaths(),
  getDownloads: () => Plugin.getDownloads().then((r) => r.list || []),
  updateDownload: (opts) => Plugin.updateDownload(opts),
  on: (event, cb) => {
    const p = Plugin.addListener(event, cb);
    return () => p.then((h) => h.remove()).catch(() => {});
  },
};

/** URL the WebView can load for an absolute device file path. */
export const fileSrc = (path) =>
  String(path || "").startsWith("content://")
    ? `/__sbcontent?u=${encodeURIComponent(path)}`
    : Capacitor.convertFileSrc(path);

/** URL of the in-app media proxy (adds the Referer the stream host wants). */
// (iOS has no in-app proxy: the stream is loaded directly)
export const proxied = (url) => url;
