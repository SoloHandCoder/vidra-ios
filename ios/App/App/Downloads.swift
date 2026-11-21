// Native downloader for the iOS app (a port of the Android app's Downloads.java).
// HLS: picks the best variant (and its audio rendition), downloads every segment,
// key and init map with 6 parallel requests and writes a local playlist
// (index.m3u8 with relative paths) next to them. Direct files (mp4) are streamed
// to disk and can be continued with a Range request.
// Downloads run while the app is open; when it goes to the background they get the
// extra time iOS allows, then pause and continue automatically when it's back.
import Foundation
import Network
import UIKit

struct DownloadError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

/** One running download: cancelling it stops all of its requests. */
final class DownloadJob {
    private let lock = NSLock()
    private var _cancelled = false
    private var _pausing = false
    private var tasks: [Int: URLSessionTask] = [:]
    var pool: OperationQueue?

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
        let p = pool
        lock.unlock()
        ts.forEach { $0.cancel() }
        p?.cancelAllOperations()
    }
}

/** Receives one response: into memory (playlists, errors) or into a file. */
private final class Sink {
    var response: HTTPURLResponse?
    let file: URL?
    let append: Bool
    let sniff: Bool
    let cap: Int
    let onBytes: ((Sink, Int) -> Void)?
    var mode = 0 // 0 undecided, 1 memory, 2 file
    var memory = Data()
    var handle: FileHandle?
    var error: Error?
    var appended = false
    let done = DispatchSemaphore(value: 0)

    init(file: URL?, append: Bool, sniff: Bool, cap: Int, onBytes: ((Sink, Int) -> Void)?) {
        self.file = file
        self.append = append
        self.sniff = sniff
        self.cap = cap
        self.onBytes = onBytes
    }

    var status: Int { response?.statusCode ?? 0 }
    var isMemory: Bool { mode == 1 }
    var text: String {
        String(data: memory, encoding: .utf8) ?? String(decoding: memory, as: UTF8.self)
    }

    func receive(_ d: Data) {
        if error != nil { return }
        if mode == 0 {
            memory.append(d)
            if memory.count >= 64 { decide() }
            return
        }
        write(d)
    }

    private func decide() {
        guard mode == 0 else { return }
        let pending = memory
        memory = Data()
        if file == nil || status >= 400 {
            mode = 1
        } else if sniff, Sink.looksLikePlaylist(pending, contentType: response?.value(forHTTPHeaderField: "Content-Type")) {
            mode = 1
        } else {
            mode = 2
            do {
                let f = file!
                let fm = FileManager.default
                if append && status == 206 && fm.fileExists(atPath: f.path) {
                    let h = try FileHandle(forWritingTo: f)
                    try h.seekToEnd()
                    handle = h
                    appended = true
                } else {
                    try? fm.removeItem(at: f)
                    fm.createFile(atPath: f.path, contents: nil)
                    handle = try FileHandle(forWritingTo: f)
                }
            } catch {
                self.error = error
                return
            }
        }
        if !pending.isEmpty { write(pending) }
    }

    private func write(_ d: Data) {
        if mode == 1 {
            memory.append(d)
            if memory.count > cap { error = DownloadError("Response too large") }
            return
        }
        do {
            try handle?.write(contentsOf: d)
            onBytes?(self, d.count)
        } catch {
            self.error = error
        }
    }

    func finish(_ err: Error?) {
        if mode == 0 { decide() }
        if error == nil { error = err }
        try? handle?.close()
        handle = nil
        done.signal()
    }

    static func looksLikePlaylist(_ d: Data, contentType: String?) -> Bool {
        let head = String(decoding: d.prefix(64), as: UTF8.self)
            .replacingOccurrences(of: "\u{FEFF}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return head.hasPrefix("#EXTM3U") || (contentType ?? "").lowercased().contains("mpegurl")
    }
}

final class Downloads: NSObject, URLSessionDataDelegate {
    static let shared = Downloads()

    /** Called with the full entry whenever a download changes (→ "downloadProgress"). */
    var onProgress: (([String: Any]) -> Void)?
    /** The web view's user agent (stream hosts sometimes tie tokens to it). */
    var userAgent: String?

    private let q = DispatchQueue(label: "app.vidra.downloads")
    private let notifyQ = DispatchQueue(label: "app.vidra.downloads.notify")
    private var list: [[String: Any]] = []
    private var active: [String: DownloadJob] = [:]
    private var lastNotify: [String: TimeInterval] = [:]
    private var saveScheduled = false
    private let jobs: OperationQueue = {
        let o = OperationQueue()
        o.maxConcurrentOperationCount = 2
        o.qualityOfService = .utility
        return o
    }()
    private var session: URLSession!
    private let sinkLock = NSLock()
    private var sinks: [Int: Sink] = [:]
    private let monitor = NWPathMonitor()
    private var path: NWPath?
    private var netCheckPending = false
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    let baseDir: URL = {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private var store: URL { baseDir.appendingPathComponent(".vidra-downloads.json") }

    private override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = 8
        cfg.timeoutIntervalForRequest = 20
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        let dq = OperationQueue()
        dq.maxConcurrentOperationCount = 1
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: dq)
        load()
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
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.enteredBackground()
        }
        nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.enteredForeground()
        }
    }

    // ───────────────────────── registry ─────────────────────────

    private func load() {
        guard let d = try? Data(contentsOf: store),
              let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] else { return }
        list = arr.map { raw in
            var o = rebased(raw)
            // downloads interrupted by the app being closed → continue automatically
            if (o["status"] as? String) == "downloading" {
                o["status"] = "paused"
                o["_autoResume"] = true
                o["speed"] = ""
                o["lastMessage"] = "Interrupted, resuming…"
            }
            return o
        }
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
            o["subtitlePaths"] = subs.map { s -> [String: Any] in
                var c = s
                if let p = c["path"] as? String { c["path"] = rebase(p) }
                return c
            }
        }
        return o
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

    // ───────────────────────── settings / network ─────────────────────────

    private let wifiKey = "sb_dl_wifiOnly"
    var wifiOnly: Bool {
        get { UserDefaults.standard.bool(forKey: wifiKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: wifiKey)
            q.async { self.onNetworkChangedLocked() }
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
            for id in Array(active.keys) { pauseLocked(id, reason: waitReason, autoResume: true) }
        } else {
            resumeAutoLocked()
        }
    }

    /** Continues downloads that were paused automatically (app closed / no network / background). */
    func resumeAuto() { q.async { self.resumeAutoLocked() } }

    private func resumeAutoLocked() {
        guard networkAllowedLocked() else { return }
        for o in list where (o["status"] as? String) == "paused" && (o["_autoResume"] as? Bool) == true {
            if let id = o["id"] as? String { resumeLocked(id) }
        }
    }

    // ───────────────────────── background ─────────────────────────

    private func enteredBackground() {
        let running = q.sync { !active.isEmpty }
        guard running, bgTask == .invalid else { return }
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "Downloads") { [weak self] in
            guard let self = self else { return }
            self.q.sync {
                for id in Array(self.active.keys) {
                    self.pauseLocked(id, reason: "Paused while Vidra was in the background", autoResume: true)
                }
            }
            self.endBackgroundTask()
        }
    }

    private func enteredForeground() {
        endBackgroundTask()
        resumeAuto()
    }

    private func endBackgroundTask() {
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
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
                    return active[did] == nil && Downloads.str(d["tmdbId"]) == tmdb && Downloads.str(d["mediaType"]) == type
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
                submitLocked(id)
            }
        }
        return id
    }

    private func submitLocked(_ id: String) {
        guard active[id] == nil else { return }
        let job = DownloadJob()
        active[id] = job
        jobs.addOperation { [weak self] in
            guard let self = self, !job.cancelled else { return }
            self.run(id, job)
        }
    }

    /** Stops a running download but keeps everything downloaded so far. */
    func pause(_ id: String, reason: String = "Paused", autoResume: Bool = false) {
        q.sync { pauseLocked(id, reason: reason, autoResume: autoResume) }
    }

    private func pauseLocked(_ id: String, reason: String, autoResume: Bool) {
        if let j = active.removeValue(forKey: id) { j.cancel(pausing: true) }
        if let o = findLocked(id), (o["status"] as? String) != "completed" {
            emitLocked(id, ["status": "paused", "speed": "", "_autoResume": autoResume, "lastMessage": reason])
        }
    }

    /** Continues a paused (or failed) download from where it stopped. */
    func resume(_ id: String) { q.sync { resumeLocked(id) } }

    private func resumeLocked(_ id: String) {
        guard let o = findLocked(id), active[id] == nil else { return }
        let st = (o["status"] as? String) ?? ""
        guard st == "paused" || st == "error" else { return }
        if !networkAllowedLocked() {
            emitLocked(id, ["status": "paused", "_autoResume": true, "lastMessage": waitReason])
            return
        }
        emitLocked(id, ["status": "downloading", "_autoResume": false, "lastMessage": "Resuming…", "speed": ""])
        submitLocked(id)
    }

    private func cancelLocked(_ id: String) {
        if let j = active.removeValue(forKey: id) { j.cancel(pausing: false) }
    }

    func delete(_ id: String, deleteFiles: Bool) {
        q.sync {
            cancelLocked(id)
            guard let i = indexLocked(id) else { return }
            if deleteFiles { deleteMedia(list[i]) }
            list.remove(at: i)
            saveNowLocked()
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

    // ───────────────────────── networking ─────────────────────────

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        sinkLock.lock(); let s = sinks[dataTask.taskIdentifier]; sinkLock.unlock()
        s?.response = response as? HTTPURLResponse
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        sinkLock.lock(); let s = sinks[dataTask.taskIdentifier]; sinkLock.unlock()
        s?.receive(data)
        if s?.error != nil { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        sinkLock.lock(); let s = sinks.removeValue(forKey: task.taskIdentifier); sinkLock.unlock()
        if s?.response == nil { s?.response = task.response as? HTTPURLResponse }
        s?.finish(error)
    }

    /** Blocking GET. With `file` the body is written there (unless it's an error / a sniffed playlist). */
    private func fetch(_ url: String, headers: [String: String], extra: [String: String] = [:], job: DownloadJob,
                       file: URL? = nil, append: Bool = false, sniff: Bool = false, timeout: TimeInterval = 20,
                       onBytes: ((Sink, Int) -> Void)? = nil) throws -> Sink {
        guard let u = URL(string: url) ?? URL(string: url.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? "") else {
            throw DownloadError("Bad URL")
        }
        var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if req.value(forHTTPHeaderField: "User-Agent") == nil, let ua = userAgent { req.setValue(ua, forHTTPHeaderField: "User-Agent") }
        for (k, v) in extra { req.setValue(v, forHTTPHeaderField: k) }
        let sink = Sink(file: file, append: append, sniff: sniff, cap: 40 * 1024 * 1024, onBytes: onBytes)
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

    // ───────────────────────── worker ─────────────────────────

    private func run(_ id: String, _ job: DownloadJob) {
        guard let e = q.sync(execute: { findLocked(id) }) else { return }
        let url = (e["m3u8Url"] as? String) ?? ""
        let name = Downloads.safeName((e["name"] as? String) ?? "Video")
        let headers = (e["_headers"] as? [String: String]) ?? [:]
        let prevDir = (e["_dir"] as? String) ?? ""
        let dir = !prevDir.isEmpty ? URL(fileURLWithPath: prevDir, isDirectory: true)
            : baseDir.appendingPathComponent("\(name)_\(id.prefix(6))", isDirectory: true)
        let partial = dir.appendingPathComponent(name + ".mp4.part")
        let mp4 = dir.appendingPathComponent(name + ".mp4")
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            var rv = URLResourceValues()
            rv.isExcludedFromBackup = true // videos don't belong in the iCloud backup
            var d = dir
            try? d.setResourceValues(rv)
            update(id, ["_dir": dir.path])
            emit(id, ["lastMessage": "Starting…"])

            if (e["_kind"] as? String) == "file", fm.fileExists(atPath: partial.path), Downloads.sizeOf(partial) > 0 {
                // continue a partly downloaded file with a Range request
                try downloadFile(id, url: url, headers: headers, part: partial, resume: true, job: job)
                if job.cancelled { return }
                try finishFile(partial: partial, mp4: mp4)
                try finish(id, e, dir: dir, name: name, headers: headers, finalPath: mp4.path, job: job)
                return
            }

            let looksHls = url.lowercased().contains(".m3u8")
            var probe: Sink?
            if !looksHls {
                // sniff the body: many hosts serve playlists from extension-less URLs
                probe = try fileProbe(id, url: url, headers: headers, part: partial, job: job)
            }
            if looksHls || probe?.isMemory == true {
                var text: String, base: String
                if let p = probe {
                    if p.status >= 400 { throw DownloadError("HTTP \(p.status)") }
                    text = p.text
                    base = p.response?.url?.absoluteString ?? url
                } else {
                    (text, base) = try fetchText(url, headers: headers, job: job)
                }
                guard text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\u{FEFF}", with: "").hasPrefix("#EXTM3U") else {
                    throw DownloadError("Not a valid HLS playlist")
                }
                update(id, ["_kind": "hls"])
                let finalPath = try downloadHls(id, url: base, text: text, dir: dir, headers: headers, job: job,
                                                maxHeight: Downloads.int(e["quality"]), fallback: e["_fallback"] as? String)
                if job.cancelled { return }
                try finish(id, e, dir: dir, name: name, headers: headers, finalPath: finalPath, job: job)
            } else {
                if job.cancelled { return }
                try finishFile(partial: partial, mp4: mp4)
                try finish(id, e, dir: dir, name: name, headers: headers, finalPath: mp4.path, job: job)
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

    private func finishFile(partial: URL, mp4: URL) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: mp4)
        try fm.moveItem(at: partial, to: mp4)
        if Downloads.sizeOf(mp4) < 64 * 1024 { throw DownloadError("Server returned no video (file too small)") }
    }

    /** First request of a non-.m3u8 URL: a playlist ends up in memory, anything else is the file itself. */
    private func fileProbe(_ id: String, url: String, headers: [String: String], part: URL, job: DownloadJob) throws -> Sink {
        let progress = FileProgress(self, id, have: 0)
        let s = try fetch(url, headers: headers, job: job, file: part, sniff: true, timeout: 20) { sink, n in progress.add(sink, n) }
        if s.isMemory { return s }
        if s.status >= 400 { throw DownloadError("HTTP \(s.status)") }
        return s
    }

    private func downloadFile(_ id: String, url: String, headers: [String: String], part: URL, resume: Bool, job: DownloadJob) throws {
        let have = Downloads.sizeOf(part)
        let progress = FileProgress(self, id, have: have)
        let s = try fetch(url, headers: headers, extra: resume ? ["Range": "bytes=\(have)-"] : [:], job: job,
                          file: part, append: resume, timeout: 20) { sink, n in progress.add(sink, n) }
        if s.status >= 400 { throw DownloadError("HTTP \(s.status)") }
    }

    /** Progress of a single-file download (size from Content-Length / Content-Range). */
    private final class FileProgress {
        weak var owner: Downloads?
        let id: String
        let have: Int64
        var started = false
        var got: Int64 = 0
        var total: Int64 = 0
        var lastT: TimeInterval = 0
        var winB: Int64 = 0
        var winT = Date().timeIntervalSince1970
        var speed = ""
        init(_ o: Downloads, _ id: String, have: Int64) { owner = o; self.id = id; self.have = have }

        func add(_ sink: Sink, _ n: Int) {
            guard let o = owner else { return }
            if !started {
                started = true
                o.update(id, ["_kind": "file"]) // a later resume continues this file
                got = sink.appended ? have : 0
                if let r = sink.response {
                    if let cr = r.value(forHTTPHeaderField: "Content-Range"), let slash = cr.lastIndex(of: "/"),
                       let t = Int64(cr[cr.index(after: slash)...].trimmingCharacters(in: .whitespaces)) {
                        total = t
                    } else if r.expectedContentLength > 0 {
                        total = r.expectedContentLength + (sink.appended ? have : 0)
                    }
                }
            }
            got += Int64(n)
            winB += Int64(n)
            let now = Date().timeIntervalSince1970
            if now - winT > 1.5 {
                speed = String(format: "%.2f MB/s", Double(winB) / (now - winT) / 1e6)
                winB = 0
                winT = now
            }
            if now - lastT > 0.5 {
                lastT = now
                let pct = total > 0 ? Int(min(99, got * 100 / total)) : 0
                let size = total > 0 ? Downloads.human(Double(total)) : Downloads.human(Double(got))
                o.emit(id, ["progress": pct, "speed": speed, "size": size,
                            "lastMessage": "\(pct)% of \(total > 0 ? size : "?")"], progressOnly: true)
            }
        }
    }

    /** Saves the subtitles chosen/captured before the download next to the video, then marks it completed. */
    private func finish(_ id: String, _ e: [String: Any], dir: URL, name: String, headers: [String: String],
                        finalPath: String, job: DownloadJob) throws {
        let subPaths = downloadSubtitles(e, dir: dir, name: name, headers: headers, job: job)
        if job.cancelled { return }
        q.sync {
            guard active[id] === job else { return }
            active[id] = nil
            emitLocked(id, ["subtitlePaths": subPaths, "status": "completed", "progress": 100, "filePath": finalPath,
                            "completedAt": Downloads.nowMs(), "lastMessage": "Completed", "speed": "",
                            "size": Downloads.human(Double(Downloads.sizeOf(dir)))])
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

    private struct Seg { let url: String; let file: URL }

    private func downloadHls(_ id: String, url: String, text: String, dir: URL, headers: [String: String], job: DownloadJob,
                             maxHeight: Int, fallback: String?) throws -> String {
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
                    let local = try planMedia(fbase, ft, dir: dir, out: &s2)
                    try fetchAll(id, s2, headers: headers, job: job)
                    let out = dir.appendingPathComponent("index.m3u8")
                    try Downloads.write(out, local)
                    return out.path
                }
                vText = got
                audioUrl = nil
            }
            let vLocal = try planMedia(vUri, vText, dir: vDir, out: &segs)
            try Downloads.write(vDir.appendingPathComponent("index.m3u8"), vLocal)
            if let au = audioUrl {
                let aDir = dir.appendingPathComponent("a", isDirectory: true)
                let (aText, aBase) = try fetchText(au, headers: headers, job: job)
                let aLocal = try planMedia(aBase, aText, dir: aDir, out: &segs)
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
            try fetchAll(id, segs, headers: headers, job: job)
            let master = dir.appendingPathComponent("index.m3u8")
            try Downloads.write(master, m)
            return master.path
        }
        var segs: [Seg] = []
        let local = try planMedia(url, text, dir: dir, out: &segs)
        try fetchAll(id, segs, headers: headers, job: job)
        let out = dir.appendingPathComponent("index.m3u8")
        try Downloads.write(out, local)
        return out.path
    }

    private static let badExt: Set<String> = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".html", ".js", ".css", ".txt", ".ico"]

    /** Rewrites a media playlist to local files and queues every referenced resource. */
    private func planMedia(_ base: String, _ text: String, dir: URL, out: inout [Seg]) throws -> String {
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
                            out.append(Seg(url: a, file: dir.appendingPathComponent(l)))
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
                out.append(Seg(url: a, file: dir.appendingPathComponent(l)))
                local = l
            }
            sb += local! + "\n"
        }
        if !sb.contains("#EXT-X-ENDLIST") { sb += "#EXT-X-ENDLIST\n" }
        return sb
    }

    private func fetchAll(_ id: String, _ segs: [Seg], headers: [String: String], job: DownloadJob) throws {
        let total = segs.count
        let lock = NSLock()
        var done = 0
        var bytes: Int64 = 0
        var winBytes: Int64 = 0
        var winStart = Date().timeIntervalSince1970
        var lastEmit: TimeInterval = 0
        var speed = ""
        var failure: Error?
        emit(id, ["totalFragments": total, "lastMessage": "Fragment 0 / \(total)"])

        let pool = OperationQueue()
        pool.maxConcurrentOperationCount = 6
        pool.qualityOfService = .utility
        job.pool = pool
        if job.cancelled { throw DownloadError("cancelled") }
        let fm = FileManager.default

        func segmentDone(_ size: Int64) {
            lock.lock()
            done += 1
            bytes += size
            let d = done
            let now = Date().timeIntervalSince1970
            var patch: [String: Any]?
            if now - lastEmit > 0.5 || d == total {
                lastEmit = now
                if now - winStart > 1.5 {
                    speed = String(format: "%.2f MB/s", Double(winBytes) / (now - winStart) / 1e6)
                    winBytes = 0
                    winStart = now
                }
                let est = d > 0 ? Double(bytes) / Double(d) * Double(total) : 0
                let pct = Int(min(99, floor(Double(d) * 100 / Double(max(1, total)))))
                patch = ["progress": pct, "completedFragments": d, "totalFragments": total, "speed": speed,
                         "size": "~" + Downloads.human(est), "lastMessage": "Fragment \(d) / \(total)"]
            }
            lock.unlock()
            if let p = patch, !job.cancelled { emit(id, p, progressOnly: true) }
        }

        for s in segs {
            pool.addOperation { [weak self] in
                guard let self = self else { return }
                lock.lock(); let failed = failure != nil; lock.unlock()
                if job.cancelled || failed { return }
                if fm.fileExists(atPath: s.file.path), Downloads.sizeOf(s.file) > 0 {
                    segmentDone(Downloads.sizeOf(s.file))
                    return
                }
                let tmp = URL(fileURLWithPath: s.file.path + ".part")
                var last: Error?
                for attempt in 0..<5 {
                    if job.cancelled { return }
                    do {
                        let r = try self.fetch(s.url, headers: headers, job: job, file: tmp, timeout: 20) { _, n in
                            lock.lock(); winBytes += Int64(n); lock.unlock()
                        }
                        if r.status >= 400 { throw DownloadError("HTTP \(r.status)") }
                        if !fm.fileExists(atPath: tmp.path) { fm.createFile(atPath: tmp.path, contents: nil) }
                        try? fm.removeItem(at: s.file)
                        try fm.moveItem(at: tmp, to: s.file)
                        last = nil
                        break
                    } catch {
                        last = error
                        if job.cancelled { return }
                        Thread.sleep(forTimeInterval: 0.6 * Double(attempt + 1))
                    }
                }
                if let l = last {
                    lock.lock(); if failure == nil { failure = l }; lock.unlock()
                    return
                }
                segmentDone(Downloads.sizeOf(s.file))
            }
        }
        pool.waitUntilAllOperationsAreFinished()
        if job.cancelled { throw DownloadError("cancelled") }
        lock.lock(); let f = failure; lock.unlock()
        if let f = f { throw DownloadError("Fragment failed: \(f.localizedDescription)") }
    }

    static func write(_ f: URL, _ s: String) throws {
        try FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(s.utf8).write(to: f, options: .atomic)
    }
}
