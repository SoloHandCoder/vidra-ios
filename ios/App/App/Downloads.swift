// Native downloader for the iOS app (a port of the Android app's Downloads.java).
// HLS: picks the best variant (and its audio rendition), plans every segment, key
// and init map and writes a local playlist (index.m3u8 with relative paths) next
// to them. Direct files (mp4) are downloaded as one file.
//
// Two phases:
//  1. Planning (app running): playlists and subtitles are fetched with a normal
//     URLSession; the result (segment URLs → local file names, the final playlist)
//     is saved as a plan file in the download's folder.
//  2. Transfer: every segment / the file is a download task of one background
//     URLSession. iOS runs those in its own process, so they keep going while
//     Vidra is in the background, the phone is locked or the app was suspended or
//     closed by the system. Each task carries "<id>|<index>|<relative path>" in its
//     taskDescription, so a finished file can be put in place even right after a
//     relaunch. A segment counts as done when its file exists, so nothing is
//     downloaded twice. When the last one lands (also when iOS relaunched the app in
//     the background just to deliver it) the playlist is written, the entry is marked
//     completed and a notification is shown if Vidra isn't on screen.
// iOS slows down background sessions with thousands of tiny tasks, so while the app
// is open only a small window of segments is queued; when the app is about to leave
// the screen the queue is topped up to a large batch (tasks created while the app is
// in the background are treated as discretionary by iOS, so this happens before).
import Foundation
import Network
import UIKit
import UserNotifications

struct DownloadError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

/** The planning step of a download: cancelling it stops its requests. */
final class DownloadJob {
    private let lock = NSLock()
    private var _cancelled = false
    private var _pausing = false
    private var tasks: [Int: URLSessionTask] = [:]

    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return _cancelled }
    var pausing: Bool { lock.lock(); defer { lock.unlock() }; return _pausing }

    /** false when the job was already cancelled (the task isn't started then). */
    func add(_ t: URLSessionTask) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if _cancelled { return false }
        tasks[t.taskIdentifier] = t
        return true
    }

    func remove(_ t: URLSessionTask) {
        lock.lock(); tasks[t.taskIdentifier] = nil; lock.unlock()
    }

    func cancel(pausing: Bool) {
        lock.lock()
        _cancelled = true
        if pausing { _pausing = true }
        let ts = Array(tasks.values)
        tasks.removeAll()
        lock.unlock()
        ts.forEach { $0.cancel() }
    }
}

/** Receives one small response (playlists, subtitles) into memory. A probe stops as soon as it's clear the body isn't a playlist. */
private final class Sink {
    var response: HTTPURLResponse?
    let probe: Bool
    let cap: Int
    var mode = 0 // 0 undecided, 1 memory, 2 not a playlist (probe only, the request is stopped)
    var memory = Data()
    var error: Error?
    let done = DispatchSemaphore(value: 0)

    init(probe: Bool, cap: Int) {
        self.probe = probe
        self.cap = cap
    }

    var status: Int { response?.statusCode ?? 0 }
    var isMemory: Bool { mode == 1 }
    var rejected: Bool { mode == 2 }
    var text: String {
        String(data: memory, encoding: .utf8) ?? String(decoding: memory, as: UTF8.self)
    }

    func receive(_ d: Data) {
        if error != nil || mode == 2 { return }
        memory.append(d)
        if mode == 0 && (!probe || memory.count >= 64) { decide() }
        if mode == 1 && memory.count > cap { error = DownloadError("Response too large") }
    }

    private func decide() {
        if !probe || status >= 400 || Sink.looksLikePlaylist(memory, contentType: response?.value(forHTTPHeaderField: "Content-Type")) {
            mode = 1
        } else {
            mode = 2
            memory = Data()
        }
    }

    func finish(_ err: Error?) {
        if mode == 0 {
            if let e = err, error == nil { error = e; done.signal(); return }
            decide()
        }
        if mode != 2 && error == nil { error = err }
        done.signal()
    }

    static func looksLikePlaylist(_ d: Data, contentType: String?) -> Bool {
        let head = String(decoding: d.prefix(64), as: UTF8.self)
            .replacingOccurrences(of: "\u{FEFF}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return head.hasPrefix("#EXTM3U") || (contentType ?? "").lowercased().contains("mpegurl")
    }
}

/** The transfer phase of one download (all state is only touched on Downloads.q). */
private final class Run {
    let id: String
    let dir: URL
    let kind: String // "hls" or "file"
    let name: String
    let headers: [String: String]
    var segs: [(url: String, rel: String)] = []
    var finalRel = "index.m3u8"
    var finalText = ""
    var fileUrl = ""
    var fileRel = ""
    var subs: [[String: Any]] = []
    var done: [Bool] = []
    var doneCount = 0
    var bytes: Int64 = 0
    /** segments before this index are done, queued or waiting for a retry */
    var scan = 0
    var inflight: [Int: URLSessionTask] = [:]
    var attempts: [Int: Int] = [:]
    var retryAt: [Int: TimeInterval] = [:]
    var fileTask: URLSessionTask?
    var fileWaitingResume = false
    var fileGot: Int64 = 0
    var fileTotal: Int64 = 0
    var winBytes: Int64 = 0
    var winStart = Date().timeIntervalSince1970
    var lastEmit: TimeInterval = 0
    var speed = ""

    init(id: String, dir: URL, kind: String, name: String, headers: [String: String]) {
        self.id = id
        self.dir = dir
        self.kind = kind
        self.name = name
        self.headers = headers
    }

    var taskCount: Int { inflight.count + (fileTask == nil ? 0 : 1) }

    func tickSpeed(_ now: TimeInterval) {
        if now - winStart > 1.5 {
            speed = String(format: "%.2f MB/s", Double(winBytes) / (now - winStart) / 1e6)
            winBytes = 0
            winStart = now
        }
    }
}

/** What a finished background task left behind (set in didFinishDownloadingTo, used in didComplete). */
private enum Outcome {
    case ok(Int64)
    case http(Int)
    case failed(String)
}

/** Keeps the app running a little longer in the background (planning, topping up the queue). */
private final class BgHold {
    private let lock = NSLock()
    private var id: UIBackgroundTaskIdentifier = .invalid

    init(_ name: String) {
        let t = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
        lock.lock(); id = t; lock.unlock()
    }

    func end() {
        lock.lock()
        let t = id
        id = .invalid
        lock.unlock()
        if t != .invalid { UIApplication.shared.endBackgroundTask(t) }
    }
}

final class Downloads: NSObject, URLSessionDataDelegate, URLSessionDownloadDelegate {
    static let shared = Downloads()
    static let sessionId = (Bundle.main.bundleIdentifier ?? "app.vidra") + ".downloads"

    /** Segment tasks queued at once while the app is open. */
    private static let liveWindow = 24
    /** Segment tasks queued at once when the app leaves the screen / runs in the background. */
    private static let bulkWindow = 2000

    /** Called with the full entry whenever a download changes (→ "downloadProgress"). */
    var onProgress: (([String: Any]) -> Void)?
    /** The web view's user agent (stream hosts sometimes tie tokens to it). Kept for background relaunches. */
    var userAgent: String? {
        didSet { if let ua = userAgent { UserDefaults.standard.set(ua, forKey: "sb_dl_ua") } }
    }
    private var effectiveUserAgent: String? { userAgent ?? UserDefaults.standard.string(forKey: "sb_dl_ua") }

    private let q = DispatchQueue(label: "app.vidra.downloads")
    private let notifyQ = DispatchQueue(label: "app.vidra.downloads.notify")
    private var list: [[String: Any]] = []
    /** downloads being planned */
    private var active: [String: DownloadJob] = [:]
    /** downloads transferring in the background session */
    private var runs: [String: Run] = [:]
    /** downloads to start once the background session's tasks are known (id → re-plan) */
    private var pendingSubmit: [String: Bool] = [:]
    private var outcomes: [Int: Outcome] = [:]
    private var attached = false
    private var bulk = false
    private var pumpScheduled = false
    private var pumping = false
    private var bgEventsHandler: (() -> Void)?
    private var bgEventsFinished = false
    private var lastNotify: [String: TimeInterval] = [:]
    private var saveScheduled = false
    private let jobs: OperationQueue = {
        let o = OperationQueue()
        o.maxConcurrentOperationCount = 2
        o.qualityOfService = .utility
        return o
    }()
    private var session: URLSession!
    private var bg: URLSession!
    private let sinkLock = NSLock()
    private var sinks: [Int: Sink] = [:]
    private let monitor = NWPathMonitor()
    private var path: NWPath?
    private var netCheckPending = false
    private var hold: BgHold?

    let baseDir: URL = {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private var store: URL { baseDir.appendingPathComponent(".vidra-downloads.json") }

    private override init() {
        super.init()
        if Thread.isMainThread { bulk = UIApplication.shared.applicationState == .background }
        load()

        // playlists / subtitles / probes while planning
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = 8
        cfg.timeoutIntervalForRequest = 20
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        let dq = OperationQueue()
        dq.maxConcurrentOperationCount = 1
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: dq)

        // segments and files: run by iOS, also while Vidra is suspended or closed
        let bcfg = URLSessionConfiguration.background(withIdentifier: Downloads.sessionId)
        bcfg.isDiscretionary = false
        bcfg.sessionSendsLaunchEvents = true
        bcfg.httpMaximumConnectionsPerHost = 6
        bcfg.timeoutIntervalForRequest = 60
        bcfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        bcfg.urlCache = nil
        bcfg.httpShouldSetCookies = false // cookies are set on each request (see bgRequest)
        let bq = OperationQueue()
        bq.maxConcurrentOperationCount = 1
        bq.underlyingQueue = q // delegate callbacks run on q, like every other state change
        bg = URLSession(configuration: bcfg, delegate: self, delegateQueue: bq)
        // re-attach to the tasks that kept running while the app was suspended / closed
        bg.getAllTasks { [weak self] tasks in
            self?.q.async { self?.attachLocked(tasks) }
        }

        monitor.pathUpdateHandler = { [weak self] p in
            guard let self = self else { return }
            self.q.async {
                self.path = p
                if self.netCheckPending { return }
                self.netCheckPending = true
                self.q.asyncAfter(deadline: .now() + 1.5) {
                    self.netCheckPending = false
                    self.onNetworkChangedLocked()
                }
            }
        }
        monitor.start(queue: DispatchQueue(label: "app.vidra.downloads.net"))
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.leavingScreen()
        }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.enteredBackground()
        }
        nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.enteredForeground()
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.becameActive()
        }
    }

    // ───────────────────────── registry ─────────────────────────

    private func load() {
        guard let d = try? Data(contentsOf: store),
              let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] else { return }
        // "downloading" entries stay as they are: their background tasks are picked up
        // again (or they're continued from their plan) once the session reports its tasks
        list = arr.map { rebased($0) }
    }

    /** The app's folder path changes with updates / reinstalls: point stored paths at the current one. */
    private func rebase(_ p: String) -> String {
        guard let r = p.range(of: "/Documents/Downloads/", options: .backwards) else { return p }
        return baseDir.path + "/" + p[r.upperBound...]
    }

    private func rebased(_ raw: [String: Any]) -> [String: Any] {
        var o = raw
        for k in ["filePath", "_dir"] {
            if let s = o[k] as? String, !s.isEmpty { o[k] = rebase(s) }
        }
        o["downloadPath"] = baseDir.path
        if let subs = o["subtitlePaths"] as? [[String: Any]] {
            o["subtitlePaths"] = rebasedSubs(subs)
        }
        return o
    }

    private func rebasedSubs(_ subs: [[String: Any]]) -> [[String: Any]] {
        subs.map { s -> [String: Any] in
            var c = s
            if let p = c["path"] as? String { c["path"] = rebase(p) }
            return c
        }
    }

    private func saveNowLocked() {
        guard JSONSerialization.isValidJSONObject(list),
              let d = try? JSONSerialization.data(withJSONObject: list) else { return }
        try? d.write(to: store, options: .atomic)
    }

    private func saveSoonLocked() {
        if saveScheduled { return }
        saveScheduled = true
        q.asyncAfter(deadline: .now() + 1.0) {
            self.saveScheduled = false
            self.saveNowLocked()
        }
    }

    private func indexLocked(_ id: String) -> Int? {
        list.firstIndex { ($0["id"] as? String) == id }
    }

    private func findLocked(_ id: String) -> [String: Any]? {
        indexLocked(id).map { list[$0] }
    }

    func all() -> [[String: Any]] { q.sync { list } }

    @discardableResult
    func update(_ id: String, _ patch: [String: Any]) -> Bool {
        q.sync {
            guard let i = indexLocked(id) else { return false }
            for (k, v) in patch { list[i][k] = v }
            saveSoonLocked()
            return true
        }
    }

    /** Updates the entry and tells the UI. Progress-only updates are limited to ~2 per second. */
    private func emitLocked(_ id: String, _ patch: [String: Any], progressOnly: Bool = false) {
        guard let i = indexLocked(id) else { return }
        for (k, v) in patch { list[i][k] = v }
        if progressOnly { saveSoonLocked() } else { saveNowLocked() }
        let now = Date().timeIntervalSince1970
        if progressOnly, let last = lastNotify[id], now - last < 0.45 { return }
        lastNotify[id] = now
        let full = list[i]
        notifyQ.async { self.onProgress?(full) }
    }

    private func emit(_ id: String, _ patch: [String: Any], progressOnly: Bool = false) {
        q.sync { emitLocked(id, patch, progressOnly: progressOnly) }
    }

    private func isRunningLocked(_ id: String) -> Bool {
        active[id] != nil || runs[id] != nil || pendingSubmit[id] != nil
    }

    // ───────────────────────── settings / network ─────────────────────────

    private let wifiKey = "sb_dl_wifiOnly"
    var wifiOnly: Bool {
        get { UserDefaults.standard.bool(forKey: wifiKey) }
        set {
            let changed = newValue != wifiOnly
            UserDefaults.standard.set(newValue, forKey: wifiKey)
            guard changed else { return }
            q.async {
                // queued requests carry the old cellular setting → queue them again
                self.requeueAllLocked()
                self.onNetworkChangedLocked()
            }
        }
    }

    private func networkAllowedLocked() -> Bool {
        guard let p = path else { return true }
        if p.status != .satisfied { return false }
        return !(wifiOnly && p.isExpensive)
    }

    var networkAllowed: Bool { q.sync { networkAllowedLocked() } }

    private var waitReason: String { wifiOnly ? "Waiting for Wi-Fi…" : "Waiting for network…" }

    private func onNetworkChangedLocked() {
        if !networkAllowedLocked() {
            // in the background iOS waits for the (Wi-Fi) network by itself; keep the tasks
            if bulk { return }
            for id in Array(active.keys) + Array(runs.keys) { pauseLocked(id, reason: waitReason, autoResume: true) }
        } else {
            resumeAutoLocked()
        }
    }

    /** Continues downloads that were paused automatically (app closed / no network). */
    func resumeAuto() { q.async { self.resumeAutoLocked() } }

    private func resumeAutoLocked() {
        guard networkAllowedLocked() else { return }
        for o in list where (o["status"] as? String) == "paused" && (o["_autoResume"] as? Bool) == true {
            if let id = o["id"] as? String { resumeLocked(id, replan: false) }
        }
    }

    // ───────────────────────── app state ─────────────────────────

    /** About to leave the screen: queue a big batch now, while iOS still treats new tasks as non-discretionary. */
    private func leavingScreen() {
        q.async {
            self.bulk = true
            self.pumpLocked()
        }
    }

    private func enteredBackground() {
        if hold == nil { hold = BgHold("Vidra downloads") }
        q.async {
            self.bulk = true
            self.pumpLocked()
            self.saveNowLocked()
            if self.active.isEmpty {
                // nothing is being planned: the background session carries on alone
                DispatchQueue.main.async { self.endHold() }
            }
        }
    }

    private func enteredForeground() {
        endHold()
        resumeAuto()
    }

    private func becameActive() {
        endHold()
        q.async { self.bulk = false }
        bg.getAllTasks { [weak self] tasks in
            guard let self = self else { return }
            self.q.async {
                guard self.attached else { return }
                self.reconcileLocked(tasks)
                self.onNetworkChangedLocked()
                self.pumpLocked()
            }
        }
    }

    private func endHold() {
        hold?.end()
        hold = nil
    }

    /** AppDelegate: iOS (re)launched the app to deliver background download events. */
    func handleBackgroundEvents(_ done: @escaping () -> Void) {
        q.async {
            self.bgEventsHandler = done
            self.flushBackgroundEventsLocked()
        }
    }

    private func flushBackgroundEventsLocked() {
        guard attached, bgEventsFinished, let h = bgEventsHandler else { return }
        bgEventsFinished = false
        bgEventsHandler = nil
        pumpLocked()
        saveNowLocked()
        DispatchQueue.main.async { h() }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        // runs on q (the background session's delegate queue)
        bgEventsFinished = true
        flushBackgroundEventsLocked()
    }

    // ───────────────────────── control ─────────────────────────

    /** Starts a download, returns its id. */
    func start(_ args: [String: Any], headers: [String: String]) -> String {
        let id = UUID().uuidString.lowercased()
        var e: [String: Any] = [
            "id": id,
            "name": (args["name"] as? String) ?? "Video",
            "m3u8Url": (args["m3u8Url"] as? String) ?? "",
            "quality": Downloads.int(args["quality"]),
            "downloadPath": baseDir.path,
            "filePath": NSNull(),
            "status": "downloading",
            "progress": 0,
            "speed": "",
            "size": "",
            "totalFragments": 0,
            "completedFragments": 0,
            "lastMessage": "Queued",
            "_headers": headers,
            "startedAt": Downloads.nowMs(),
            "completedAt": NSNull(),
            "subtitlePaths": [Any](),
        ]
        if let fb = args["fallbackUrl"] as? String, !fb.isEmpty, fb != "null" { e["_fallback"] = fb }
        for k in ["mediaId", "mediaType", "season", "episode", "posterPath", "tmdbId"] {
            e[k] = args[k] ?? NSNull()
        }
        if e["tmdbId"] is NSNull, !(e["mediaId"] is NSNull) { e["tmdbId"] = e["mediaId"] }
        e["subtitles"] = (args["subtitles"] as? [Any]) ?? [Any]()

        q.sync {
            // a new download of the same title / episode replaces the old entry (like desktop)
            let tmdb = Downloads.str(e["tmdbId"]), type = Downloads.str(e["mediaType"])
            let s = Downloads.str(e["season"]), ep = Downloads.str(e["episode"])
            if !tmdb.isEmpty {
                let stale = list.filter { d in
                    let did = (d["id"] as? String) ?? ""
                    return !isRunningLocked(did) && Downloads.str(d["tmdbId"]) == tmdb && Downloads.str(d["mediaType"]) == type
                        && Downloads.str(d["season"]) == s && Downloads.str(d["episode"]) == ep
                }
                for d in stale { deleteMedia(d) }
                let ids = Set(stale.compactMap { $0["id"] as? String })
                list.removeAll { ids.contains(($0["id"] as? String) ?? "") }
            }
            list.insert(e, at: 0)
            saveNowLocked()
            if !networkAllowedLocked() {
                emitLocked(id, ["status": "paused", "_autoResume": true, "lastMessage": waitReason])
            } else {
                submitLocked(id, replan: true)
            }
        }
        return id
    }

    /** replan: fetch the playlists again (fresh links); otherwise continue from the saved plan if there is one. */
    private func submitLocked(_ id: String, replan: Bool) {
        guard active[id] == nil, runs[id] == nil else { return }
        if !attached {
            pendingSubmit[id] = replan || (pendingSubmit[id] ?? false)
            return
        }
        pendingSubmit[id] = nil
        if !replan, let r = runFromPlanLocked(id) {
            startTransferLocked(r)
            return
        }
        let job = DownloadJob()
        active[id] = job
        jobs.addOperation { [weak self] in
            guard let self = self, !job.cancelled else { return }
            self.plan(id, job)
        }
    }

    /** Stops a running download but keeps everything downloaded so far. */
    func pause(_ id: String, reason: String = "Paused", autoResume: Bool = false) {
        q.sync { pauseLocked(id, reason: reason, autoResume: autoResume) }
    }

    private func pauseLocked(_ id: String, reason: String, autoResume: Bool) {
        pendingSubmit[id] = nil
        if let j = active.removeValue(forKey: id) { j.cancel(pausing: true) }
        if let r = runs.removeValue(forKey: id) { cancelTasksLocked(r, keepResumeData: true) }
        if let o = findLocked(id), (o["status"] as? String) != "completed" {
            emitLocked(id, ["status": "paused", "speed": "", "_autoResume": autoResume, "lastMessage": reason])
        }
    }

    /** Continues a paused (or failed) download from where it stopped. */
    func resume(_ id: String) { q.sync { resumeLocked(id, replan: true) } }

    private func resumeLocked(_ id: String, replan: Bool) {
        guard let o = findLocked(id), !isRunningLocked(id) else { return }
        let st = (o["status"] as? String) ?? ""
        guard st == "paused" || st == "error" else { return }
        if !networkAllowedLocked() {
            emitLocked(id, ["status": "paused", "_autoResume": true, "lastMessage": waitReason])
            return
        }
        emitLocked(id, ["status": "downloading", "_autoResume": false, "lastMessage": "Resuming…", "speed": ""])
        submitLocked(id, replan: replan || st == "error")
    }

    private func cancelLocked(_ id: String) {
        pendingSubmit[id] = nil
        if let j = active.removeValue(forKey: id) { j.cancel(pausing: false) }
        if let r = runs.removeValue(forKey: id) { cancelTasksLocked(r, keepResumeData: false) }
    }

    func delete(_ id: String, deleteFiles: Bool) {
        q.sync {
            cancelLocked(id)
            guard let i = indexLocked(id) else { return }
            if deleteFiles { deleteMedia(list[i]) }
            list.remove(at: i)
            saveNowLocked()
            pumpLocked()
        }
    }

    func deleteAll() -> Int {
        q.sync {
            var n = 0
            for o in list {
                cancelLocked((o["id"] as? String) ?? "")
                if deleteMedia(o) { n += 1 }
            }
            list.removeAll()
            saveNowLocked()
            return n
        }
    }

    func clearRegistry() {
        q.sync {
            for o in list { cancelLocked((o["id"] as? String) ?? "") }
            list.removeAll()
            saveNowLocked()
        }
    }

    @discardableResult
    private func deleteMedia(_ o: [String: Any]) -> Bool {
        let fm = FileManager.default
        var ok = false
        if let dir = o["_dir"] as? String, !dir.isEmpty, isInside(dir) {
            ok = (try? fm.removeItem(atPath: dir)) != nil
        } else if let fp = o["filePath"] as? String, !fp.isEmpty {
            ok = (try? fm.removeItem(atPath: fp)) != nil
        }
        for s in (o["subtitlePaths"] as? [[String: Any]]) ?? [] {
            if let p = s["path"] as? String { try? fm.removeItem(atPath: p) }
        }
        return ok
    }

    /** Only folders inside the downloads folder are ever removed recursively. */
    private func isInside(_ p: String) -> Bool {
        let base = baseDir.standardizedFileURL.path
        let x = URL(fileURLWithPath: p).standardizedFileURL.path
        return x.hasPrefix(base + "/") && x != base
    }

    func totalSize() -> Int64 {
        let entries = all()
        var s: Int64 = 0
        for o in entries {
            if let dir = o["_dir"] as? String, !dir.isEmpty { s += Downloads.sizeOf(URL(fileURLWithPath: dir)) }
            else if let fp = o["filePath"] as? String, !fp.isEmpty { s += Downloads.sizeOf(URL(fileURLWithPath: fp)) }
        }
        return s
    }

    // ───────────────────────── helpers ─────────────────────────

    static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    static func int(_ v: Any?) -> Int {
        if let n = v as? NSNumber { return n.intValue }
        if let s = v as? String { return Int(s) ?? 0 }
        return 0
    }

    static func str(_ v: Any?) -> String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return ""
    }

    static func human(_ bytes: Double) -> String {
        if bytes > 1e9 { return String(format: "%.2f GB", bytes / 1e9) }
        if bytes > 1e6 { return String(format: "%.1f MB", bytes / 1e6) }
        if bytes > 1e3 { return String(format: "%.1f KB", bytes / 1e3) }
        return "\(Int64(bytes)) B"
    }

    static func sizeOf(_ u: URL) -> Int64 {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: u.path, isDirectory: &isDir) else { return 0 }
        if !isDir.boolValue {
            return Int64((try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        var s: Int64 = 0
        if let e = fm.enumerator(at: u, includingPropertiesForKeys: [.fileSizeKey]) {
            for case let f as URL in e { s += Int64((try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        }
        return s
    }

    static func safeName(_ s: String) -> String {
        var n = s.components(separatedBy: CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)).joined()
            .trimmingCharacters(in: .whitespaces)
        if n.hasPrefix(".") { n = String(n.drop(while: { $0 == "." })) }
        if n.isEmpty { n = "Video" }
        if n.count > 80 { n = String(n.prefix(80)) }
        return n
    }

    private static func makeURL(_ s: String) -> URL? {
        URL(string: s) ?? URL(string: s.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? "")
    }

    /** A GET with the download's headers, the web view's user agent, cookies and the Wi-Fi-only setting. */
    private func request(_ url: String, headers: [String: String], timeout: TimeInterval, cookies: Bool) -> URLRequest? {
        guard let u = Downloads.makeURL(url) else { return nil }
        var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if req.value(forHTTPHeaderField: "User-Agent") == nil, let ua = effectiveUserAgent { req.setValue(ua, forHTTPHeaderField: "User-Agent") }
        if cookies, req.value(forHTTPHeaderField: "Cookie") == nil,
           let cs = HTTPCookieStorage.shared.cookies(for: u), !cs.isEmpty,
           let c = HTTPCookie.requestHeaderFields(with: cs)["Cookie"] {
            req.setValue(c, forHTTPHeaderField: "Cookie")
        }
        let wifi = wifiOnly
        req.allowsCellularAccess = !wifi
        req.allowsExpensiveNetworkAccess = !wifi
        return req
    }

    private static func planURL(_ dir: URL) -> URL { dir.appendingPathComponent(".vidra-plan.json") }
    private static func resumeURL(_ dir: URL) -> URL { dir.appendingPathComponent(".vidra-resume.dat") }

    private static func readPlan(_ dir: URL) -> [String: Any]? {
        guard let d = try? Data(contentsOf: planURL(dir)) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    /** "<id>|<segment index or -1 for a file>|<path relative to the download folder>" */
    private struct Tag {
        let id: String
        let index: Int
        let rel: String

        init?(_ s: String?) {
            guard let s = s else { return nil }
            let p = s.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false)
            guard p.count == 3, let i = Int(p[1]), !p[0].isEmpty, !p[2].isEmpty else { return nil }
            id = String(p[0])
            index = i
            rel = String(p[2])
        }

        static func make(_ id: String, _ i: Int, _ rel: String) -> String { "\(id)|\(i)|\(rel)" }
    }

    // ───────────────────────── planning requests (foreground session) ─────────────────────────

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        sinkLock.lock(); let s = sinks[dataTask.taskIdentifier]; sinkLock.unlock()
        s?.response = response as? HTTPURLResponse
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        sinkLock.lock(); let s = sinks[dataTask.taskIdentifier]; sinkLock.unlock()
        s?.receive(data)
        if s?.error != nil || s?.rejected == true { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if session === bg {
            bgCompletedLocked(task, error) // on q
            return
        }
        sinkLock.lock(); let s = sinks.removeValue(forKey: task.taskIdentifier); sinkLock.unlock()
        if s?.response == nil { s?.response = task.response as? HTTPURLResponse }
        s?.finish(error)
    }

    /** Blocking GET into memory. A probe stops early when the body isn't a playlist (→ `rejected`). */
    private func fetch(_ url: String, headers: [String: String], job: DownloadJob, probe: Bool = false,
                       timeout: TimeInterval = 20) throws -> Sink {
        guard let req = request(url, headers: headers, timeout: timeout, cookies: false) else { throw DownloadError("Bad URL") }
        let sink = Sink(probe: probe, cap: 40 * 1024 * 1024)
        let task = session.dataTask(with: req)
        sinkLock.lock(); sinks[task.taskIdentifier] = sink; sinkLock.unlock()
        guard job.add(task) else {
            sinkLock.lock(); sinks[task.taskIdentifier] = nil; sinkLock.unlock()
            throw DownloadError("cancelled")
        }
        task.resume()
        sink.done.wait()
        job.remove(task)
        if job.cancelled { throw DownloadError("cancelled") }
        if let err = sink.error { throw err }
        return sink
    }

    private func fetchText(_ url: String, headers: [String: String], job: DownloadJob) throws -> (String, String) {
        var last: Error = DownloadError("Playlist failed")
        for _ in 0..<3 {
            if job.cancelled { throw DownloadError("cancelled") }
            do {
                let s = try fetch(url, headers: headers, job: job, timeout: 15)
                if s.status >= 400 { throw DownloadError("HTTP \(s.status) for playlist") }
                return (s.text, s.response?.url?.absoluteString ?? url)
            } catch { last = error }
        }
        throw last
    }

    // ───────────────────────── planning ─────────────────────────

    private func plan(_ id: String, _ job: DownloadJob) {
        let h = BgHold("Vidra download")
        defer { h.end() }
        guard let e = q.sync(execute: { findLocked(id) }) else {
            q.sync { if active[id] === job { active[id] = nil } }
            return
        }
        let url = (e["m3u8Url"] as? String) ?? ""
        let name = Downloads.safeName((e["name"] as? String) ?? "Video")
        let headers = (e["_headers"] as? [String: String]) ?? [:]
        let prevDir = (e["_dir"] as? String) ?? ""
        let dir = !prevDir.isEmpty ? URL(fileURLWithPath: prevDir, isDirectory: true)
            : baseDir.appendingPathComponent("\(name)_\(id.prefix(6))", isDirectory: true)
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            var rv = URLResourceValues()
            rv.isExcludedFromBackup = true // videos don't belong in the iCloud backup
            var d = dir
            try? d.setResourceValues(rv)
            update(id, ["_dir": dir.path])
            emit(id, ["lastMessage": "Starting…"])

            var p: [String: Any]
            let filePlan: [String: Any] = ["kind": "file", "url": url, "rel": name + ".mp4"]
            if (e["_kind"] as? String) == "file", fm.fileExists(atPath: Downloads.resumeURL(dir).path) {
                // continue a partly downloaded file
                p = filePlan
            } else {
                let looksHls = url.lowercased().contains(".m3u8")
                var probe: Sink?
                if !looksHls {
                    // sniff the body: many hosts serve playlists from extension-less URLs
                    probe = try fetch(url, headers: headers, job: job, probe: true, timeout: 20)
                }
                if looksHls || probe?.isMemory == true {
                    var text: String, base: String
                    if let pr = probe {
                        if pr.status >= 400 { throw DownloadError("HTTP \(pr.status)") }
                        text = pr.text
                        base = pr.response?.url?.absoluteString ?? url
                    } else {
                        (text, base) = try fetchText(url, headers: headers, job: job)
                    }
                    guard text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\u{FEFF}", with: "").hasPrefix("#EXTM3U") else {
                        throw DownloadError("Not a valid HLS playlist")
                    }
                    update(id, ["_kind": "hls"])
                    let hp = try planHls(url: base, text: text, dir: dir, headers: headers, job: job,
                                         maxHeight: Downloads.int(e["quality"]), fallback: e["_fallback"] as? String)
                    p = ["kind": "hls", "segs": hp.segs.map { [$0.url, $0.rel] }, "final": hp.finalRel, "finalText": hp.finalText]
                } else {
                    update(id, ["_kind": "file"]) // a later resume continues this file
                    p = filePlan
                }
            }
            if job.cancelled { return }
            p["subs"] = downloadSubtitles(e, dir: dir, name: name, headers: headers, job: job)
            if job.cancelled { return }
            guard JSONSerialization.isValidJSONObject(p) else { throw DownloadError("Couldn't save the download plan") }
            try JSONSerialization.data(withJSONObject: p).write(to: Downloads.planURL(dir), options: .atomic)
            q.sync {
                guard active[id] === job else { return }
                active[id] = nil
                guard let e2 = findLocked(id), let r = makeRun(id, dir: dir, plan: p, entry: e2) else {
                    emitLocked(id, ["status": "error", "lastMessage": "Error: nothing to download", "speed": ""])
                    return
                }
                startTransferLocked(r)
            }
        } catch {
            let paused = job.pausing
            q.sync {
                if active[id] === job { active[id] = nil }
                if paused || job.cancelled { return }
                if !networkAllowedLocked() {
                    // connection dropped / switched to mobile data → wait and continue later
                    emitLocked(id, ["status": "paused", "_autoResume": true, "speed": "", "lastMessage": waitReason])
                    return
                }
                emitLocked(id, ["status": "error", "lastMessage": "Error: \(error.localizedDescription)", "speed": ""])
            }
        }
    }

    private func downloadSubtitles(_ e: [String: Any], dir: URL, name: String, headers: [String: String], job: DownloadJob) -> [[String: Any]] {
        var out: [[String: Any]] = []
        guard let subs = e["subtitles"] as? [[String: Any]] else { return out }
        var used = Set<String>()
        for s in subs {
            let url = (s["url"] as? String) ?? ""
            var lang = String(((s["lang"] as? String) ?? "unknown").unicodeScalars.filter {
                CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-"
            })
            if lang.isEmpty { lang = "unknown" }
            if lang.count > 12 { lang = String(lang.prefix(12)) }
            var data: Data?
            var ext = "vtt"
            if url.hasPrefix("data:"), let comma = url.firstIndex(of: ",") {
                let meta = String(url[url.index(url.startIndex, offsetBy: 5)..<comma])
                let payload = String(url[url.index(after: comma)...])
                data = meta.contains(";base64") ? Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
                    : (payload.removingPercentEncoding ?? payload).data(using: .utf8)
                if meta.lowercased().contains("srt") || meta.lowercased().contains("subrip") { ext = "srt" }
            } else if url.hasPrefix("http") {
                guard let r = try? fetch(url, headers: headers, job: job, timeout: 15), r.status < 400 else { continue }
                data = r.memory
                let ct = (r.response?.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
                let path = url.lowercased().components(separatedBy: "?")[0]
                if path.hasSuffix(".srt") || ct.contains("srt") || ct.contains("subrip") { ext = "srt" }
            }
            guard let d = data, !d.isEmpty else { continue }
            var fname = "\(name).\(lang).\(ext)"
            var n = 2
            while used.contains(fname) { fname = "\(name).\(lang).\(n).\(ext)"; n += 1 }
            used.insert(fname)
            let f = dir.appendingPathComponent(fname)
            guard (try? d.write(to: f)) != nil else { continue }
            out.append(["lang": (s["lang"] as? String) ?? "unknown", "path": f.path,
                        "name": (s["name"] as? String) ?? fname, "file_id": s["file_id"] ?? NSNull()])
        }
        return out
    }

    // ───────────────────────── transfer (background session, all on q) ─────────────────────────

    private func runFromPlanLocked(_ id: String) -> Run? {
        guard let e = findLocked(id), let ds = e["_dir"] as? String, !ds.isEmpty else { return nil }
        let dir = URL(fileURLWithPath: ds, isDirectory: true)
        guard let p = Downloads.readPlan(dir) else { return nil }
        return makeRun(id, dir: dir, plan: p, entry: e)
    }

    private func makeRun(_ id: String, dir: URL, plan p: [String: Any], entry e: [String: Any]) -> Run? {
        let kind = (p["kind"] as? String) ?? "hls"
        let r = Run(id: id, dir: dir, kind: kind, name: (e["name"] as? String) ?? "Video",
                    headers: (e["_headers"] as? [String: String]) ?? [:])
        r.subs = rebasedSubs((p["subs"] as? [[String: Any]]) ?? [])
        if kind == "file" {
            r.fileUrl = (p["url"] as? String) ?? ""
            r.fileRel = (p["rel"] as? String) ?? ""
            if r.fileUrl.isEmpty || r.fileRel.isEmpty { return nil }
            return r
        }
        guard let segs = p["segs"] as? [[String]] else { return nil }
        r.segs = segs.compactMap { s -> (url: String, rel: String)? in s.count == 2 ? (url: s[0], rel: s[1]) : nil }
        r.finalRel = (p["final"] as? String) ?? "index.m3u8"
        r.finalText = (p["finalText"] as? String) ?? ""
        if r.finalText.isEmpty { return nil }
        r.done = Array(repeating: false, count: r.segs.count)
        for (i, s) in r.segs.enumerated() {
            let sz = Downloads.sizeOf(dir.appendingPathComponent(s.rel))
            if sz > 0 {
                r.done[i] = true
                r.doneCount += 1
                r.bytes += sz
            }
        }
        return r
    }

    private func startTransferLocked(_ r: Run) {
        runs[r.id] = r
        if r.kind == "file" {
            let dest = r.dir.appendingPathComponent(r.fileRel)
            let hasResume = FileManager.default.fileExists(atPath: Downloads.resumeURL(r.dir).path)
            if r.fileTask == nil, !hasResume, Downloads.sizeOf(dest) >= 64 * 1024 {
                // finished while the app wasn't running and the completion got lost
                finishLocked(r)
                return
            }
            emitLocked(r.id, ["lastMessage": "Downloading…"])
        } else {
            let total = r.segs.count
            emitLocked(r.id, ["totalFragments": total, "completedFragments": r.doneCount,
                              "lastMessage": "Fragment \(r.doneCount) / \(total)"])
            if r.doneCount == total {
                finishLocked(r)
                return
            }
        }
        pumpLocked()
    }

    /** Queues more tasks: a small window while the app is open, a big batch otherwise. Oldest download first. */
    private func pumpLocked() {
        guard attached, !pumping, !runs.isEmpty else { return }
        pumping = true
        defer { pumping = false }
        let cap = bulk ? Downloads.bulkWindow : Downloads.liveWindow
        var used = runs.values.reduce(0) { $0 + $1.taskCount }
        let now = Date().timeIntervalSince1970
        var nextRetry: TimeInterval?
        let order = list.reversed().compactMap { $0["id"] as? String }
        outer: for id in order {
            guard used < cap else { break }
            guard let r = runs[id] else { continue }
            if r.kind == "file" {
                if r.fileTask != nil || r.fileWaitingResume { continue }
                if let t = r.retryAt[-1], t > now { nextRetry = min(nextRetry ?? t, t); continue }
                r.retryAt[-1] = nil
                if startFileTaskLocked(r) { used += 1 }
                continue
            }
            // retries that are due
            for (i, t) in r.retryAt {
                if used >= cap { break outer }
                if t > now { nextRetry = min(nextRetry ?? t, t); continue }
                r.retryAt[i] = nil
                if r.done[i] || r.inflight[i] != nil { continue }
                if !enqueueLocked(r, i) { continue outer }
                used += 1
            }
            while used < cap && r.scan < r.segs.count {
                let i = r.scan
                r.scan += 1
                if r.done[i] || r.inflight[i] != nil || r.retryAt[i] != nil { continue }
                if !enqueueLocked(r, i) { continue outer }
                used += 1
            }
        }
        if let t = nextRetry, !pumpScheduled {
            pumpScheduled = true
            q.asyncAfter(deadline: .now() + max(0.05, t - now)) {
                self.pumpScheduled = false
                self.pumpLocked()
            }
        }
    }

    /** false when the run failed (bad URL). */
    private func enqueueLocked(_ r: Run, _ i: Int) -> Bool {
        let s = r.segs[i]
        guard let req = request(s.url, headers: r.headers, timeout: 60, cookies: true) else {
            failRunLocked(r, "Bad fragment URL")
            return false
        }
        let t = bg.downloadTask(with: req)
        t.taskDescription = Tag.make(r.id, i, s.rel)
        r.inflight[i] = t
        t.resume()
        return true
    }

    private func startFileTaskLocked(_ r: Run) -> Bool {
        let rd = Downloads.resumeURL(r.dir)
        let t: URLSessionDownloadTask
        if let data = try? Data(contentsOf: rd), !data.isEmpty {
            try? FileManager.default.removeItem(at: rd) // used once; a failed resume starts over
            t = bg.downloadTask(withResumeData: data)
        } else {
            guard let req = request(r.fileUrl, headers: r.headers, timeout: 60, cookies: true) else {
                failRunLocked(r, "Bad URL")
                return false
            }
            t = bg.downloadTask(with: req)
        }
        t.taskDescription = Tag.make(r.id, -1, r.fileRel)
        r.fileTask = t
        t.resume()
        return true
    }

    private func cancelTasksLocked(_ r: Run, keepResumeData: Bool) {
        r.inflight.values.forEach { $0.cancel() }
        r.inflight.removeAll()
        r.retryAt.removeAll()
        guard let ft = r.fileTask else { return }
        r.fileTask = nil
        if keepResumeData, let dt = ft as? URLSessionDownloadTask {
            let rd = Downloads.resumeURL(r.dir)
            dt.cancel(byProducingResumeData: { d in if let d = d { try? d.write(to: rd, options: .atomic) } })
        } else {
            ft.cancel()
        }
    }

    /** The Wi-Fi-only setting changed: queue everything again with the new setting. */
    private func requeueAllLocked() {
        for r in runs.values {
            r.inflight.values.forEach { $0.cancel() }
            r.inflight.removeAll()
            r.scan = 0
            if let dt = r.fileTask as? URLSessionDownloadTask {
                r.fileTask = nil
                r.fileWaitingResume = true
                let rd = Downloads.resumeURL(r.dir)
                dt.cancel(byProducingResumeData: { [weak self] d in
                    if let d = d { try? d.write(to: rd, options: .atomic) }
                    self?.q.async {
                        r.fileWaitingResume = false
                        self?.pumpLocked()
                    }
                })
            }
        }
        pumpLocked()
    }

    /** The background session's current tasks: adopt the ones of running downloads, stop leftovers. */
    private func reconcileLocked(_ tasks: [URLSessionTask]) {
        for t in tasks where t.state == .running || t.state == .suspended {
            guard let tag = Tag(t.taskDescription), let r = runs[tag.id] else {
                t.cancel() // a download that isn't running any more (paused, deleted, finished)
                continue
            }
            if tag.index < 0 {
                if r.kind == "file" && r.fileTask == nil { r.fileTask = t }
                else if r.fileTask?.taskIdentifier != t.taskIdentifier { t.cancel(); continue }
            } else if tag.index < r.segs.count && !r.done[tag.index] {
                if let have = r.inflight[tag.index] {
                    if have.taskIdentifier != t.taskIdentifier { t.cancel(); continue }
                } else {
                    r.inflight[tag.index] = t
                }
            } else {
                t.cancel()
                continue
            }
            if t.state == .suspended { t.resume() }
        }
        // tasks that ended without their completion reaching us → queue them again
        for r in runs.values {
            for (i, t) in r.inflight where t.state == .completed {
                r.inflight[i] = nil
                r.scan = min(r.scan, i)
            }
            if let ft = r.fileTask, ft.state == .completed { r.fileTask = nil }
        }
    }

    private func attachLocked(_ tasks: [URLSessionTask]) {
        // downloads that were running when the app was suspended / closed
        var built: [Run] = []
        for o in list where (o["status"] as? String) == "downloading" {
            guard let id = o["id"] as? String, active[id] == nil, runs[id] == nil, pendingSubmit[id] == nil else { continue }
            if let r = runFromPlanLocked(id) {
                runs[id] = r
                built.append(r)
            } else {
                pendingSubmit[id] = true // was still being planned → plan again
            }
        }
        reconcileLocked(tasks)
        attached = true
        for r in built where runs[r.id] === r { startTransferLocked(r) }
        let pending = pendingSubmit
        pendingSubmit.removeAll()
        for (id, replan) in pending { submitLocked(id, replan: replan) }
        pumpLocked()
        flushBackgroundEventsLocked()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let tag = Tag(downloadTask.taskDescription), let r = runs[tag.id] else { return }
        r.winBytes += bytesWritten
        guard tag.index < 0, r.fileTask?.taskIdentifier == downloadTask.taskIdentifier else { return }
        r.fileGot = totalBytesWritten
        if totalBytesExpectedToWrite > 0 { r.fileTotal = totalBytesExpectedToWrite }
        let now = Date().timeIntervalSince1970
        r.tickSpeed(now)
        guard now - r.lastEmit > 0.5 else { return }
        r.lastEmit = now
        let total = r.fileTotal, got = r.fileGot
        let pct = total > 0 ? Int(min(99, got * 100 / total)) : 0
        let size = total > 0 ? Downloads.human(Double(total)) : Downloads.human(Double(got))
        emitLocked(r.id, ["progress": pct, "speed": r.speed, "size": size,
                          "lastMessage": "\(pct)% of \(total > 0 ? size : "?")"], progressOnly: true)
    }

    /** The file only exists during this call: move it into the download's folder right away. */
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let tid = downloadTask.taskIdentifier
        guard let tag = Tag(downloadTask.taskDescription), let e = findLocked(tag.id),
              (e["status"] as? String) != "completed",
              let ds = e["_dir"] as? String, !ds.isEmpty else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        if status >= 400 {
            outcomes[tid] = .http(status)
            return
        }
        let dest = URL(fileURLWithPath: ds, isDirectory: true).appendingPathComponent(tag.rel)
        guard isInside(dest.path) else { return }
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.removeItem(at: dest)
            try fm.moveItem(at: location, to: dest)
            outcomes[tid] = .ok(Downloads.sizeOf(dest))
        } catch {
            outcomes[tid] = .failed(error.localizedDescription)
        }
    }

    private func bgCompletedLocked(_ task: URLSessionTask, _ error: Error?) {
        let outcome = outcomes.removeValue(forKey: task.taskIdentifier)
        guard let tag = Tag(task.taskDescription), let r = runs[tag.id] else { return }
        let cancelled = (error as NSError?).map { $0.domain == NSURLErrorDomain && $0.code == NSURLErrorCancelled } ?? false
        let now = Date().timeIntervalSince1970

        if tag.index < 0 {
            guard r.fileTask?.taskIdentifier == task.taskIdentifier else { return }
            r.fileTask = nil
            switch outcome {
            case .ok?:
                if Downloads.sizeOf(r.dir.appendingPathComponent(r.fileRel)) < 64 * 1024 {
                    failRunLocked(r, "Server returned no video (file too small)")
                } else {
                    finishLocked(r)
                }
                return
            case .http(let s)?:
                failRunLocked(r, "HTTP \(s)")
                return
            default:
                break
            }
            if let d = (error as NSError?)?.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
                try? d.write(to: Downloads.resumeURL(r.dir), options: .atomic)
            }
            if !cancelled && networkAllowedLocked() {
                let n = (r.attempts[-1] ?? 0) + 1
                r.attempts[-1] = n
                if n >= 5 {
                    failRunLocked(r, error?.localizedDescription ?? "Download failed")
                    return
                }
                r.retryAt[-1] = now + (bulk ? 0 : 2.0 * Double(n))
            }
            pumpLocked()
            return
        }

        guard tag.index < r.segs.count else { return }
        let i = tag.index
        let mine = r.inflight[i]?.taskIdentifier == task.taskIdentifier
        if mine { r.inflight[i] = nil }
        if case .ok(let size)? = outcome {
            if !r.done[i] {
                r.done[i] = true
                r.doneCount += 1
                r.bytes += size
                r.attempts[i] = nil
                r.retryAt[i] = nil
            }
            segmentProgressLocked(r, now)
            if r.doneCount == r.segs.count {
                finishLocked(r)
            } else {
                pumpLocked()
            }
            return
        }
        guard mine else { return }
        r.scan = min(r.scan, i)
        if cancelled || !networkAllowedLocked() {
            // stopped by the system / no network: queue it again without counting an attempt
            pumpLocked()
            return
        }
        let msg: String
        switch outcome {
        case .http(let s)?: msg = "HTTP \(s)"
        case .failed(let m)?: msg = m
        default: msg = error?.localizedDescription ?? "Download failed"
        }
        let n = (r.attempts[i] ?? 0) + 1
        r.attempts[i] = n
        if n >= 5 {
            failRunLocked(r, "Fragment failed: \(msg)")
            return
        }
        r.retryAt[i] = now + (bulk ? 0 : 0.6 * Double(n))
        pumpLocked()
    }

    private func segmentProgressLocked(_ r: Run, _ now: TimeInterval) {
        r.tickSpeed(now)
        let d = r.doneCount, total = r.segs.count
        let est = d > 0 ? Double(r.bytes) / Double(d) * Double(total) : 0
        let pct = Int(min(99, floor(Double(d) * 100 / Double(max(1, total)))))
        emitLocked(r.id, ["progress": pct, "completedFragments": d, "totalFragments": total, "speed": r.speed,
                          "size": "~" + Downloads.human(est), "lastMessage": "Fragment \(d) / \(total)"], progressOnly: true)
    }

    private func failRunLocked(_ r: Run, _ msg: String) {
        guard runs[r.id] === r else { return }
        runs[r.id] = nil
        cancelTasksLocked(r, keepResumeData: true)
        if !networkAllowedLocked() {
            emitLocked(r.id, ["status": "paused", "_autoResume": true, "speed": "", "lastMessage": waitReason])
        } else {
            emitLocked(r.id, ["status": "error", "lastMessage": "Error: \(msg)", "speed": ""])
        }
        pumpLocked()
    }

    /** Everything is there: write the playlist, mark the entry completed, tell the user. */
    private func finishLocked(_ r: Run) {
        guard runs[r.id] === r else { return }
        runs[r.id] = nil
        cancelTasksLocked(r, keepResumeData: false)
        let finalPath: String
        if r.kind == "file" {
            finalPath = r.dir.appendingPathComponent(r.fileRel).path
        } else {
            let f = r.dir.appendingPathComponent(r.finalRel)
            do {
                try Downloads.write(f, r.finalText)
            } catch {
                emitLocked(r.id, ["status": "error", "lastMessage": "Error: \(error.localizedDescription)", "speed": ""])
                return
            }
            finalPath = f.path
        }
        try? FileManager.default.removeItem(at: Downloads.planURL(r.dir))
        try? FileManager.default.removeItem(at: Downloads.resumeURL(r.dir))
        var patch: [String: Any] = ["subtitlePaths": r.subs, "status": "completed", "progress": 100, "filePath": finalPath,
                                    "completedAt": Downloads.nowMs(), "lastMessage": "Completed", "speed": "",
                                    "size": Downloads.human(Double(Downloads.sizeOf(r.dir)))]
        if r.kind != "file" { patch["completedFragments"] = r.segs.count; patch["totalFragments"] = r.segs.count }
        emitLocked(r.id, patch)
        notifyFinished(r.id, r.name)
        pumpLocked()
    }

    /** A notification when a download finishes while Vidra isn't on screen (permission is asked when a download starts). */
    private func notifyFinished(_ id: String, _ name: String) {
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .active else { return }
            let center = UNUserNotificationCenter.current()
            center.getNotificationSettings { s in
                guard s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
                    || s.authorizationStatus == .ephemeral else { return }
                let c = UNMutableNotificationContent()
                c.title = "Download finished"
                c.body = name
                c.sound = .default
                center.add(UNNotificationRequest(identifier: "sbdl_" + id, content: c, trigger: nil))
            }
        }
    }

    // ───────────────────────── HLS ─────────────────────────

    private static let attrRe = try! NSRegularExpression(pattern: "([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)")

    static func attrs(_ line: String) -> [String: String] {
        var m: [String: String] = [:]
        guard let c = line.firstIndex(of: ":") else { return m }
        let body = String(line[line.index(after: c)...])
        let ns = body as NSString
        for r in attrRe.matches(in: body, range: NSRange(location: 0, length: ns.length)) {
            let k = ns.substring(with: r.range(at: 1))
            var v = ns.substring(with: r.range(at: 2))
            if v.count >= 2, v.hasPrefix("\""), v.hasSuffix("\"") { v = String(v.dropFirst().dropLast()) }
            m[k] = v
        }
        return m
    }

    static func abs(_ base: String, _ rel: String) -> String {
        let r = rel.trimmingCharacters(in: .whitespaces)
        guard let b = URL(string: base),
              let u = URL(string: r, relativeTo: b) ?? URL(string: r.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? "", relativeTo: b)
        else { return r }
        let a = u.absoluteURL
        // hosts that sign playlists with ?token=… often expect the same token on
        // child requests (their player adds it client-side) → inherit it
        if a.query == nil, let bq = b.query, a.host?.lowercased() == b.host?.lowercased(), bq.lowercased().contains("token") {
            return a.absoluteString + "?" + bq
        }
        return a.absoluteString
    }

    private static func lines(_ text: String) -> [String] {
        text.components(separatedBy: .newlines)
    }

    /** A file to download: its URL and its path relative to the download folder. */
    private struct Seg { let url: String; let rel: String }

    private struct HlsPlan {
        var segs: [Seg]
        var finalRel: String
        var finalText: String
    }

    /** Picks the variant, writes the media playlists and returns what's left to download plus the final playlist. */
    private func planHls(url: String, text: String, dir: URL, headers: [String: String], job: DownloadJob,
                         maxHeight: Int, fallback: String?) throws -> HlsPlan {
        if text.contains("#EXT-X-STREAM-INF") {
            // master playlist → best variant (within the chosen quality)
            let ls = Downloads.lines(text)
            var bestBw: Int64 = -1
            var bestUri: String?, bestInf: String?
            var lowH = Int64.max
            var lowUri: String?, lowInf: String?
            var audioByGroup: [String: String] = [:]
            for i in 0..<ls.count {
                let l = ls[i].trimmingCharacters(in: .whitespaces)
                if l.hasPrefix("#EXT-X-MEDIA:") {
                    let a = Downloads.attrs(l)
                    if a["TYPE"] == "AUDIO", let uri = a["URI"] {
                        let g = a["GROUP-ID"] ?? ""
                        if audioByGroup[g] == nil || a["DEFAULT"] == "YES" { audioByGroup[g] = Downloads.abs(url, uri) }
                    }
                } else if l.hasPrefix("#EXT-X-STREAM-INF") {
                    let a = Downloads.attrs(l)
                    var bw = Int64(a["BANDWIDTH"] ?? "0") ?? 0
                    var h: Int64 = -1
                    if let res = a["RESOLUTION"], let x = res.lowercased().split(separator: "x").last, let hv = Int64(x) {
                        h = hv
                        bw += hv * 1_000_000_000
                    }
                    var j = i + 1
                    while j < ls.count, ls[j].trimmingCharacters(in: .whitespaces).isEmpty || ls[j].trimmingCharacters(in: .whitespaces).hasPrefix("#") { j += 1 }
                    if j >= ls.count { continue }
                    let uri = Downloads.abs(url, ls[j])
                    if h > 0 && h < lowH { lowH = h; lowUri = uri; lowInf = l }
                    // chosen quality: allow a little slack (1088p, 736p …)
                    let fits = maxHeight <= 0 || h <= 0 || h <= Int64(maxHeight + 40)
                    if fits && bw > bestBw { bestBw = bw; bestUri = uri; bestInf = l }
                }
            }
            if bestUri == nil, let lu = lowUri { bestUri = lu; bestInf = lowInf }
            guard var vUri = bestUri, let infLine = bestInf else { throw DownloadError("No playable variant in playlist") }
            let inf = Downloads.attrs(infLine)
            var audioUrl = inf["AUDIO"].flatMap { audioByGroup[$0] }

            var segs: [Seg] = []
            let vDir = dir.appendingPathComponent("v", isDirectory: true)
            var vText: String
            do {
                (vText, vUri) = try fetchText(vUri, headers: headers, job: job)
            } catch {
                guard let fb = fallback, !job.cancelled else { throw error }
                // host adds per-playlist tokens client-side: borrow the token of the
                // playlist the player loaded, else download that playlist itself
                var t: String?
                if let qi = fb.firstIndex(of: "?") {
                    let alt = vUri + (vUri.contains("?") ? "&" : "?") + String(fb[fb.index(after: qi)...])
                    if let r = try? fetchText(alt, headers: headers, job: job) { t = r.0; vUri = r.1 }
                }
                guard let got = t else {
                    let (ft, fbase) = try fetchText(fb, headers: headers, job: job)
                    var s2: [Seg] = []
                    let local = try planMedia(fbase, ft, dir: dir, prefix: "", out: &s2)
                    return HlsPlan(segs: s2, finalRel: "index.m3u8", finalText: local)
                }
                vText = got
                audioUrl = nil
            }
            let vLocal = try planMedia(vUri, vText, dir: vDir, prefix: "v/", out: &segs)
            try Downloads.write(vDir.appendingPathComponent("index.m3u8"), vLocal)
            if let au = audioUrl {
                let aDir = dir.appendingPathComponent("a", isDirectory: true)
                let (aText, aBase) = try fetchText(au, headers: headers, job: job)
                let aLocal = try planMedia(aBase, aText, dir: aDir, prefix: "a/", out: &segs)
                try Downloads.write(aDir.appendingPathComponent("index.m3u8"), aLocal)
            }
            var m = "#EXTM3U\n"
            var si = "#EXT-X-STREAM-INF:BANDWIDTH=\(inf["BANDWIDTH"] ?? "1000000")"
            if let r = inf["RESOLUTION"] { si += ",RESOLUTION=\(r)" }
            if let c = inf["CODECS"] { si += ",CODECS=\"\(c)\"" }
            if audioUrl != nil {
                m += "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"Audio\",DEFAULT=YES,AUTOSELECT=YES,URI=\"a/index.m3u8\"\n"
                si += ",AUDIO=\"aud\""
            }
            m += si + "\nv/index.m3u8\n"
            return HlsPlan(segs: segs, finalRel: "index.m3u8", finalText: m)
        }
        var segs: [Seg] = []
        let local = try planMedia(url, text, dir: dir, prefix: "", out: &segs)
        return HlsPlan(segs: segs, finalRel: "index.m3u8", finalText: local)
    }

    private static let badExt: Set<String> = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".html", ".js", ".css", ".txt", ".ico"]

    /** Rewrites a media playlist to local files and lists every referenced resource (`prefix`: its folder inside the download). */
    private func planMedia(_ base: String, _ text: String, dir: URL, prefix: String, out: inout [Seg]) throws -> String {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var seen: [String: String] = [:]
        var sb = ""
        var n = 0, k = 0
        for line in Downloads.lines(text) {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { continue }
            if t.hasPrefix("#") {
                if t.hasPrefix("#EXT-X-KEY") || t.hasPrefix("#EXT-X-MAP") || t.hasPrefix("#EXT-X-SESSION-KEY"), t.contains("URI=\"") {
                    var rest = Substring(t)
                    var b = ""
                    while let r = rest.range(of: "URI=\"") {
                        b += rest[..<r.upperBound]
                        rest = rest[r.upperBound...]
                        guard let endQ = rest.firstIndex(of: "\"") else { break }
                        let u = String(rest[..<endQ])
                        rest = rest[endQ...]
                        if u.hasPrefix("skd:") || u.hasPrefix("data:") { b += u; continue }
                        let a = Downloads.abs(base, u)
                        var local = seen[a]
                        if local == nil {
                            k += 1
                            let l = (t.hasPrefix("#EXT-X-MAP") ? "init" : "key") + "\(k).bin"
                            seen[a] = l
                            out.append(Seg(url: a, rel: prefix + l))
                            local = l
                        }
                        b += local!
                    }
                    b += rest
                    sb += b + "\n"
                } else {
                    sb += t + "\n"
                }
                continue
            }
            let a = Downloads.abs(base, t)
            var local = seen[a]
            if local == nil {
                let path = a.components(separatedBy: "?")[0]
                let last = path.split(separator: "/").last.map(String.init) ?? ""
                var ext = last.range(of: ".", options: .backwards).map { String(last[$0.lowerBound...]).lowercased() } ?? ".ts"
                let valid = ext.count <= 6 && ext.dropFirst().allSatisfy { $0.isLetter || $0.isNumber } && ext.count > 1
                if !valid { ext = ".ts" }
                // fake image / page extensions used by some hosts → keep the bytes but name them .ts
                if Downloads.badExt.contains(ext) { ext = ".ts" }
                n += 1
                let l = String(format: "s%05ld", n) + ext
                seen[a] = l
                out.append(Seg(url: a, rel: prefix + l))
                local = l
            }
            sb += local! + "\n"
        }
        if !sb.contains("#EXT-X-ENDLIST") { sb += "#EXT-X-ENDLIST\n" }
        return sb
    }

    static func write(_ f: URL, _ s: String) throws {
        try FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(s.utf8).write(to: f, options: .atomic)
    }
}
