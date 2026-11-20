// iOS side of the app's native plugin ("Vidra"). Same method names as the
// Android plugin (StreambertPlugin.java) so the shared JS works unchanged.
// What's not possible / not built on iOS yet resolves with a harmless default
// (downloads, Chromecast, widgets, background episode checks, voice search).
import AVFoundation
import Capacitor
import Foundation
import LocalAuthentication
import UIKit
import UserNotifications
import WebKit

@objc(StreambertPlugin)
public class StreambertPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "StreambertPlugin"
    public let jsName = "Streambert"
    public let pluginMethods: [CAPPluginMethod] = [
        "http", "writeFile", "readFile", "deleteFile", "fileExists", "getPaths", "scanDirectory",
        "startDownload", "pauseDownload", "resumeDownload", "getDownloadSettings", "setDownloadSettings",
        "pickDownloadFolder", "getDownloads", "deleteDownload", "deleteAllDownloads", "clearDownloadRegistry",
        "updateDownload", "networkInfo", "getDownloadsSize", "getVideoDuration", "getBlockStats", "getStreamMeta",
        "voiceSearch", "openExternal", "openInPlayer", "showNotification", "scheduleReminders", "setKeepScreenOn",
        "setFullscreen", "exitFullscreen", "exitApp", "getCacheSize", "clearCache", "clearCookies",
        "setPlaybackState", "updateWidget", "pinWidget", "getLockSettings", "shareImage", "shareText", "verifyUser",
        "setLockSettings", "syncEpisodeWatch", "getEpisodeState", "runEpisodeCheckNow", "setInterceptFullscreen",
        "enterPip", "setBrightness", "setVolume", "getLevels", "getDeviceInfo", "takeIncoming", "installUpdate",
        "cancelUpdate",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    static let releasesPage = "https://github.com/SoloHandCoder/vidra-ios/releases/latest"

    // ───────────── links opened with the app (streambert://…) ─────────────
    private static var pendingIncoming: String?
    private static weak var shared: StreambertPlugin?

    /** AppDelegate hands every opened URL here (cold start or while running). */
    public static func deliverIncoming(_ text: String) {
        if let p = shared {
            p.notifyListeners("incoming", data: ["text": text], retainUntilConsumed: true)
        } else {
            pendingIncoming = text
        }
    }

    private let lock = AppLockController()

    override public func load() {
        StreambertPlugin.shared = self
        UNUserNotificationCenter.current().delegate = self
        installFrameScript()
        installAdBlock()
        lock.attach(to: bridge?.viewController)
    }

    // Every frame (embedded players too) gets the same helper script as on Android:
    // the executeJavaScript bridge, popup stub and per-site tweaks.
    private func installFrameScript() {
        guard let url = Bundle.main.url(forResource: "sb-inject", withExtension: "js", subdirectory: "public/native"),
              let src = try? String(contentsOf: url, encoding: .utf8) else { return }
        let script = WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        // load() runs on the main thread before the app page is loaded
        bridge?.webView?.configuration.userContentController.addUserScript(script)
    }

    // Ad / tracker hosts from the shared block list → a WebKit content blocker.
    private func installAdBlock() {
        guard let url = Bundle.main.url(forResource: "sb-blocklist", withExtension: "txt", subdirectory: "public/native"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        var rules: [[String: Any]] = []
        for raw in text.components(separatedBy: .newlines) {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") || line.hasPrefix("!") { continue }
            if line.hasPrefix("*.") { line.removeFirst(2) }
            let parts = line.split(separator: "/", maxSplits: 1).map(String.init)
            let host = NSRegularExpression.escapedPattern(for: parts[0])
            let path = parts.count > 1 ? "/" + NSRegularExpression.escapedPattern(for: parts[1]) : "[/:?]"
            rules.append(["trigger": ["url-filter": "^https?://([^/]*\\.)?\(host)\(path)"], "action": ["type": "block"]])
        }
        guard !rules.isEmpty, let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else { return }
        WKContentRuleListStore.default()?.compileContentRuleList(forIdentifier: "sb-adblock", encodedContentRuleList: json) { [weak self] list, _ in
            guard let list = list else { return }
            DispatchQueue.main.async {
                self?.bridge?.webView?.configuration.userContentController.add(list)
            }
        }
    }

    // Embedded players trying to replace the whole app with an ad page → blocked.
    // (iframes may navigate freely inside their own frame.)
    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return nil }
        let isMain = navigationAction.targetFrame?.isMainFrame ?? true
        if !isMain { return NSNumber(value: false) }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "capacitor" || url.host == "localhost" { return nil }
        if scheme == "about" || scheme == "blob" || scheme == "data" { return NSNumber(value: false) }
        return NSNumber(value: true)
    }

    // ───────────── network ─────────────
    @objc func http(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { return call.reject("bad url") }
        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        req.timeoutInterval = Double(call.getInt("timeout") ?? 15000) / 1000.0
        for (k, v) in call.getObject("headers") ?? [:] { req.setValue("\(v)", forHTTPHeaderField: k) }
        if let body = call.getString("body") { req.httpBody = body.data(using: .utf8) }
        let base64 = call.getString("responseType") == "base64"
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { return call.reject(err.localizedDescription) }
            let http = resp as? HTTPURLResponse
            var headers: [String: String] = [:]
            for (k, v) in http?.allHeaderFields ?? [:] { headers[String(describing: k).lowercased()] = String(describing: v) }
            let d = data ?? Data()
            call.resolve([
                "status": http?.statusCode ?? 0,
                "url": http?.url?.absoluteString ?? s,
                "headers": headers,
                "data": base64 ? d.base64EncodedString() : (String(data: d, encoding: .utf8) ?? String(decoding: d, as: UTF8.self)),
            ])
        }.resume()
    }

    @objc func networkInfo(_ call: CAPPluginCall) {
        // a light check: iOS doesn't tell the app cheaply whether the network is metered
        call.resolve(["connected": true, "unmetered": true])
    }

    // ───────────── files ─────────────
    private var fm: FileManager { FileManager.default }
    private func dir(_ d: FileManager.SearchPathDirectory) -> URL { fm.urls(for: d, in: .userDomainMask)[0] }

    @objc func getPaths(_ call: CAPPluginCall) {
        let downloads = dir(.documentDirectory).appendingPathComponent("Downloads", isDirectory: true)
        try? fm.createDirectory(at: downloads, withIntermediateDirectories: true)
        let files = dir(.applicationSupportDirectory)
        try? fm.createDirectory(at: files, withIntermediateDirectories: true)
        call.resolve([
            "downloads": downloads.path,
            "files": files.path,
            "cache": dir(.cachesDirectory).path,
            "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
        ])
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { return call.reject("no path") }
        let data = call.getString("data") ?? ""
        let bytes = call.getString("encoding") == "base64" ? (Data(base64Encoded: data, options: .ignoreUnknownCharacters) ?? Data()) : Data(data.utf8)
        let url = URL(fileURLWithPath: path)
        do {
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try bytes.write(to: url)
            call.resolve(["path": path])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let d = fm.contents(atPath: path) else { return call.reject("not found") }
        call.resolve(["data": call.getString("encoding") == "base64" ? d.base64EncodedString() : String(decoding: d, as: UTF8.self)])
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? "/nonexistent"
        call.resolve(["ok": (try? fm.removeItem(atPath: path)) != nil])
    }

    @objc func fileExists(_ call: CAPPluginCall) {
        call.resolve(["exists": fm.fileExists(atPath: call.getString("path") ?? "")])
    }

    @objc func scanDirectory(_ call: CAPPluginCall) {
        let exts: Set<String> = ["mp4", "mkv", "webm", "mov", "m4v", "ts"]
        var out: [[String: Any]] = []
        let root = URL(fileURLWithPath: call.getString("path") ?? "")
        if let e = fm.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) {
            for case let u as URL in e where exts.contains(u.pathExtension.lowercased()) {
                let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                out.append(["filePath": u.path, "name": u.deletingPathExtension().lastPathComponent,
                            "size": ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file),
                            "ext": "." + u.pathExtension.lowercased()])
            }
        }
        call.resolve(["files": out])
    }

    @objc func getVideoDuration(_ call: CAPPluginCall) {
        let asset = AVURLAsset(url: URL(fileURLWithPath: call.getString("path") ?? ""))
        let s = CMTimeGetSeconds(asset.duration)
        call.resolve(["seconds": s.isFinite ? s : 0])
    }

    // ───────────── downloads (not in the iOS version yet) ─────────────
    private let noDownloads = "Downloads aren't available in the iOS version yet."
    @objc func startDownload(_ call: CAPPluginCall) { call.resolve(["ok": false, "error": noDownloads]) }
    @objc func pauseDownload(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func resumeDownload(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func getDownloadSettings(_ call: CAPPluginCall) { call.resolve([:]) }
    @objc func setDownloadSettings(_ call: CAPPluginCall) { call.resolve([:]) }
    @objc func pickDownloadFolder(_ call: CAPPluginCall) { call.reject(noDownloads) }
    @objc func getDownloads(_ call: CAPPluginCall) { call.resolve(["list": []]) }
    @objc func deleteDownload(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func deleteAllDownloads(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func clearDownloadRegistry(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func updateDownload(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func getDownloadsSize(_ call: CAPPluginCall) { call.resolve(["bytes": 0]) }
    @objc func getStreamMeta(_ call: CAPPluginCall) { call.resolve([:]) }
    @objc func getBlockStats(_ call: CAPPluginCall) { call.resolve([:]) }
    @objc func voiceSearch(_ call: CAPPluginCall) { call.reject("Voice search isn't available on iOS yet.") }

    // ───────────── system ─────────────
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { return call.reject("bad url") }
        DispatchQueue.main.async { UIApplication.shared.open(url) { ok in call.resolve(["ok": ok]) } }
    }

    @objc func openInPlayer(_ call: CAPPluginCall) {
        guard let s = call.getString("url") ?? call.getString("path") else { return call.reject("no url") }
        let url = s.hasPrefix("/") ? URL(fileURLWithPath: s) : URL(string: s)
        guard let u = url else { return call.reject("bad url") }
        DispatchQueue.main.async { UIApplication.shared.open(u) { ok in call.resolve(["ok": ok]) } }
    }

    @objc func setKeepScreenOn(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on; call.resolve() }
    }

    // iOS plays web video fullscreen in its own player, so these just succeed.
    @objc func setFullscreen(_ call: CAPPluginCall) { call.resolve() }
    @objc func exitFullscreen(_ call: CAPPluginCall) { call.resolve() }
    @objc func setInterceptFullscreen(_ call: CAPPluginCall) { call.resolve() }
    @objc func enterPip(_ call: CAPPluginCall) { call.resolve(["ok": false]) }
    @objc func exitApp(_ call: CAPPluginCall) { call.resolve() }
    @objc func setPlaybackState(_ call: CAPPluginCall) { call.resolve() }
    @objc func updateWidget(_ call: CAPPluginCall) { call.resolve() }
    @objc func pinWidget(_ call: CAPPluginCall) { call.resolve(["ok": false]) }
    @objc func syncEpisodeWatch(_ call: CAPPluginCall) { call.resolve() }
    @objc func getEpisodeState(_ call: CAPPluginCall) { call.resolve([:]) }
    @objc func runEpisodeCheckNow(_ call: CAPPluginCall) { call.resolve() }

    @objc func setBrightness(_ call: CAPPluginCall) {
        let v = call.getDouble("value") ?? -1
        DispatchQueue.main.async {
            if v >= 0 { UIScreen.main.brightness = CGFloat(min(1, v)) }
            call.resolve()
        }
    }
    @objc func setVolume(_ call: CAPPluginCall) { call.resolve() } // apps can't set the system volume on iOS
    @objc func getLevels(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["brightness": Double(UIScreen.main.brightness), "volume": Double(AVAudioSession.sharedInstance().outputVolume)])
        }
    }

    @objc func getDeviceInfo(_ call: CAPPluginCall) {
        call.resolve(["tv": false, "pip": false, "ios": true])
    }

    @objc func getCacheSize(_ call: CAPPluginCall) {
        DispatchQueue.global().async {
            var total: Int64 = 0
            if let e = self.fm.enumerator(at: self.dir(.cachesDirectory), includingPropertiesForKeys: [.fileSizeKey]) {
                for case let u as URL in e { total += Int64((try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
            }
            call.resolve(["bytes": total])
        }
    }

    @objc func clearCache(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache], modifiedSince: .distantPast) {
                call.resolve(["ok": true])
            }
        }
    }

    @objc func clearCookies(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantPast) {
                call.resolve(["ok": true])
            }
        }
    }

    @objc func takeIncoming(_ call: CAPPluginCall) {
        let t = StreambertPlugin.pendingIncoming
        StreambertPlugin.pendingIncoming = nil
        if let t = t { call.resolve(["text": t]) } else { call.resolve([:]) }
    }

    // ───────────── sharing ─────────────
    private func present(_ items: [Any], _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { return call.reject("no view") }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let pop = sheet.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            vc.present(sheet, animated: true)
            call.resolve(["ok": true])
        }
    }

    @objc func shareText(_ call: CAPPluginCall) { present([call.getString("text") ?? ""], call) }

    @objc func shareImage(_ call: CAPPluginCall) {
        guard let d = Data(base64Encoded: call.getString("base64") ?? "", options: .ignoreUnknownCharacters) else { return call.reject("bad image") }
        let name = (call.getString("name") ?? "streambert.png").replacingOccurrences(of: "/", with: "_")
        let url = dir(.cachesDirectory).appendingPathComponent(name)
        try? d.write(to: url)
        var items: [Any] = [url]
        if let t = call.getString("text"), !t.isEmpty { items.append(t) }
        present(items, call)
    }

    // ───────────── notifications ─────────────
    private func withPermission(_ then: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in then(ok) }
    }

    @objc func showNotification(_ call: CAPPluginCall) {
        let c = UNMutableNotificationContent()
        c.title = call.getString("title") ?? "Vidra"
        c.body = call.getString("body") ?? ""
        if let url = call.getString("url") { c.userInfo = ["url": url] }
        withPermission { ok in
            if ok { UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil)) }
            call.resolve()
        }
    }

    /** release-time reminders: [{ showId, title, text, at (ms) }] → local notifications */
    @objc func scheduleReminders(_ call: CAPPluginCall) {
        let items = call.getArray("items", JSObject.self) ?? []
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { reqs in
            center.removePendingNotificationRequests(withIdentifiers: reqs.map(\.identifier).filter { $0.hasPrefix("sbrem_") })
            guard !items.isEmpty else { return call.resolve(["scheduled": 0]) }
            self.withPermission { _ in
                var n = 0
                for r in items {
                    let at = (r["at"] as? Double) ?? Double((r["at"] as? Int) ?? 0)
                    let show = r["showId"].map { "\($0)" } ?? ""
                    let when = Date(timeIntervalSince1970: at / 1000)
                    guard when > Date() else { continue }
                    let c = UNMutableNotificationContent()
                    c.title = (r["title"] as? String) ?? "New episode"
                    c.body = (r["text"] as? String) ?? ""
                    if !show.isEmpty { c.userInfo = ["url": "streambert://open/tv/\(show)"] }
                    let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: when)
                    let id = "sbrem_\(show)_\(n)_\(Int(at))"
                    center.add(UNNotificationRequest(identifier: id, content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
                    n += 1
                }
                call.resolve(["scheduled": n])
            }
        }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                       withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if #available(iOS 14.0, *) { completionHandler([.banner, .sound]) } else { completionHandler([.alert, .sound]) }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                       withCompletionHandler completionHandler: @escaping () -> Void) {
        if let url = response.notification.request.content.userInfo["url"] as? String { StreambertPlugin.deliverIncoming(url) }
        completionHandler()
    }

    // ───────────── app lock / identity ─────────────
    @objc func verifyUser(_ call: CAPPluginCall) {
        AppLockController.authenticate(reason: call.getString("title") ?? "Vidra") { ok in call.resolve(["ok": ok]) }
    }

    @objc func getLockSettings(_ call: CAPPluginCall) {
        call.resolve(lock.settings())
    }

    @objc func setLockSettings(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled")
        let timeout = call.getInt("timeoutMs")
        let apply = {
            if let e = enabled { UserDefaults.standard.set(e, forKey: AppLockController.enabledKey) }
            if let t = timeout { UserDefaults.standard.set(t, forKey: AppLockController.timeoutKey) }
            call.resolve(self.lock.settings())
        }
        if enabled == nil && !lock.isEnabled { return apply() }
        if !AppLockController.available {
            if enabled == true { return call.reject("Set up Face ID, Touch ID or a passcode on your iPhone first.") }
            return apply()
        }
        AppLockController.authenticate(reason: enabled == true ? "Turn on app lock" : "Change app lock") { ok in
            if ok { apply() } else { call.reject("Not verified") }
        }
    }

    // ───────────── updates ─────────────
    // iOS can't install an app from inside another app: open the release page instead
    // (install the new .ipa with AltStore / SideStore / Sideloadly as before).
    @objc func installUpdate(_ call: CAPPluginCall) {
        guard let url = URL(string: StreambertPlugin.releasesPage) else { return call.resolve(["ok": false]) }
        notifyListeners("updateProgress", data: ["percent": 100, "label": "Opening the release page…"])
        DispatchQueue.main.async { UIApplication.shared.open(url) { ok in call.resolve(["ok": ok]) } }
    }

    @objc func cancelUpdate(_ call: CAPPluginCall) { call.resolve() }
}

/** Face ID / passcode lock when coming back to the app after a while (like Android's app lock). */
final class AppLockController {
    static let enabledKey = "sb_lock_enabled"
    static let timeoutKey = "sb_lock_timeout"
    private weak var vc: UIViewController?
    private var cover: UIView?
    private var leftAt: Date?
    private var authenticating = false

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: AppLockController.enabledKey) }
    var timeoutMs: Int {
        let t = UserDefaults.standard.integer(forKey: AppLockController.timeoutKey)
        return UserDefaults.standard.object(forKey: AppLockController.timeoutKey) == nil ? 60000 : t
    }

    static var available: Bool {
        var err: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
    }

    static func authenticate(reason: String, _ done: @escaping (Bool) -> Void) {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { return done(false) }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in DispatchQueue.main.async { done(ok) } }
    }

    func settings() -> [String: Any] {
        ["enabled": isEnabled, "timeoutMs": timeoutMs, "available": AppLockController.available,
         "reason": AppLockController.available ? "" : "Set up Face ID, Touch ID or a passcode on your iPhone first."]
    }

    func attach(to vc: UIViewController?) {
        self.vc = vc
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.leftAt = Date()
            if self.isEnabled { self.showCover() } // hide content in the app switcher
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.cameBack()
        }
        if isEnabled { DispatchQueue.main.async { self.showCover(); self.unlock() } }
    }

    private func cameBack() {
        guard isEnabled, cover != nil else { return }
        let away = leftAt.map { Date().timeIntervalSince($0) * 1000 } ?? Double.infinity
        if away < Double(timeoutMs) { hideCover() } else { unlock() }
    }

    private func unlock() {
        guard !authenticating else { return }
        authenticating = true
        AppLockController.authenticate(reason: "Unlock Vidra") { [weak self] ok in
            self?.authenticating = false
            if ok { self?.hideCover() }
        }
    }

    private func showCover() {
        guard cover == nil, let root = vc?.view else { return }
        let v = UIView(frame: root.bounds)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.04, alpha: 1)
        let b = UIButton(type: .system)
        b.setTitle("Unlock Vidra", for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .boldSystemFont(ofSize: 17)
        b.backgroundColor = UIColor(red: 0.9, green: 0.04, blue: 0.08, alpha: 1)
        b.layer.cornerRadius = 12
        b.frame = CGRect(x: 0, y: 0, width: 220, height: 50)
        b.center = CGPoint(x: v.bounds.midX, y: v.bounds.midY)
        b.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
        b.addAction(UIAction { [weak self] _ in self?.unlock() }, for: .touchUpInside)
        v.addSubview(b)
        root.addSubview(v)
        cover = v
    }

    private func hideCover() {
        cover?.removeFromSuperview()
        cover = nil
    }
}
