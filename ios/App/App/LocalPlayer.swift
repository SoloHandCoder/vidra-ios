// Plays downloaded videos in iOS's own player (AVPlayerViewController).
// AVPlayer doesn't reliably play an HLS playlist from a file:// URL, so downloaded
// HLS folders are served by a tiny HTTP server on 127.0.0.1 (random port, random
// path token, only the downloads folder). MP4 files play straight from disk.
import AVFoundation
import AVKit
import Foundation
import Network
import UIKit

final class LocalMediaServer {
    static let shared = LocalMediaServer()

    private let q = DispatchQueue(label: "app.vidra.mediaserver")
    private var listener: NWListener?
    private var port: UInt16 = 0
    private let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    private var root: URL { Downloads.shared.baseDir.resolvingSymlinksInPath() }

    /** http://127.0.0.1:<port>/<token>/<path inside the downloads folder>, or nil. */
    func url(for file: URL) -> URL? {
        let rootPath = root.standardizedFileURL.path
        let p = file.resolvingSymlinksInPath().standardizedFileURL.path
        guard p.hasPrefix(rootPath + "/") else { return nil }
        guard let port = ensureStarted() else { return nil }
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#;%")
        let rel = p.dropFirst(rootPath.count + 1).split(separator: "/")
            .map { String($0).addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
            .joined(separator: "/")
        return URL(string: "http://127.0.0.1:\(port)/\(token)/\(rel)")
    }

    private func ensureStarted() -> UInt16? {
        if let p = q.sync(execute: { () -> UInt16? in port != 0 ? port : nil }) { return p }
        let sem = DispatchSemaphore(value: 0)
        q.async {
            if self.port != 0 { sem.signal(); return }
            self.listener?.cancel()
            do {
                let params = NWParameters.tcp
                params.allowLocalEndpointReuse = true
                params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
                let l = try NWListener(using: params)
                var signalled = false
                l.newConnectionHandler = { [weak self] c in self?.handle(c) }
                l.stateUpdateHandler = { [weak self] st in
                    guard let self = self else { return }
                    switch st {
                    case .ready:
                        self.port = l.port?.rawValue ?? 0
                    case .failed, .cancelled:
                        if self.listener === l { self.listener = nil; self.port = 0 }
                    default:
                        return
                    }
                    if !signalled { signalled = true; sem.signal() }
                }
                self.listener = l
                l.start(queue: self.q)
            } catch {
                sem.signal()
            }
        }
        _ = sem.wait(timeout: .now() + 3)
        return q.sync { () -> UInt16? in port != 0 ? port : nil }
    }

    private func handle(_ c: NWConnection) {
        c.start(queue: q)
        receive(c, Data())
    }

    private func receive(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, err in
            guard let self = self else { c.cancel(); return }
            var b = buf
            if let d = data { b.append(d) }
            if let r = b.range(of: Data("\r\n\r\n".utf8)) {
                self.respond(c, String(decoding: b[b.startIndex..<r.lowerBound], as: UTF8.self))
            } else if err != nil || complete || b.count > 65536 {
                c.cancel()
            } else {
                self.receive(c, b)
            }
        }
    }

    private static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "m3u8": return "application/vnd.apple.mpegurl"
        case "ts": return "video/mp2t"
        case "aac": return "audio/aac"
        case "mp4", "m4s", "m4v", "mov": return "video/mp4"
        case "m4a": return "audio/mp4"
        case "vtt", "webvtt": return "text/vtt"
        default: return "application/octet-stream"
        }
    }

    private func simple(_ c: NWConnection, _ status: String) {
        let h = "HTTP/1.1 \(status)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        c.send(content: Data(h.utf8), completion: .contentProcessed { _ in self.close(c) })
    }

    private func close(_ c: NWConnection) {
        c.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
    }

    private func respond(_ c: NWConnection, _ head: String) {
        let lines = head.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        guard parts.count >= 2 else { return simple(c, "400 Bad Request") }
        let method = String(parts[0])
        var target = String(parts[1])
        if let qm = target.firstIndex(of: "?") { target = String(target[..<qm]) }
        let prefix = "/\(token)/"
        guard method == "GET" || method == "HEAD", target.hasPrefix(prefix),
              let rel = String(target.dropFirst(prefix.count)).removingPercentEncoding,
              !rel.isEmpty, !rel.split(separator: "/").contains(where: { $0 == ".." || $0 == "." })
        else { return simple(c, "404 Not Found") }
        let file = root.appendingPathComponent(rel)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), !isDir.boolValue,
              let fh = try? FileHandle(forReadingFrom: file)
        else { return simple(c, "404 Not Found") }
        let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
        let size: UInt64 = (attrs?[.size] as? NSNumber)?.uint64Value ?? 0
        var start: UInt64 = 0
        var end: UInt64 = size > 0 ? size - 1 : 0
        var partial = false
        if let rl = lines.first(where: { $0.lowercased().hasPrefix("range:") }),
           let eq = rl.firstIndex(of: "=") {
            let spec = rl[rl.index(after: eq)...].trimmingCharacters(in: .whitespaces).split(separator: ",").first ?? ""
            let ab = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            if ab.count == 2 {
                if ab[0].isEmpty, let n = UInt64(ab[1]), n > 0 {
                    start = size > n ? size - n : 0
                    partial = true
                } else if let a = UInt64(ab[0]) {
                    start = a
                    if let b = UInt64(ab[1]), b < size { end = b }
                    partial = true
                }
            }
            if partial && (size == 0 || start >= size || start > end) {
                try? fh.close()
                let h = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */\(size)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                c.send(content: Data(h.utf8), completion: .contentProcessed { _ in self.close(c) })
                return
            }
        }
        let len: UInt64 = size == 0 ? 0 : end - start + 1
        var h = "HTTP/1.1 \(partial ? "206 Partial Content" : "200 OK")\r\n"
        h += "Content-Type: \(LocalMediaServer.mime(file.pathExtension))\r\n"
        h += "Content-Length: \(len)\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\nConnection: close\r\n"
        if partial { h += "Content-Range: bytes \(start)-\(end)/\(size)\r\n" }
        h += "\r\n"
        c.send(content: Data(h.utf8), completion: .contentProcessed { err in
            if err != nil || method == "HEAD" || len == 0 {
                try? fh.close()
                if err != nil { c.cancel() } else { self.close(c) }
                return
            }
            do { try fh.seek(toOffset: start) } catch { try? fh.close(); c.cancel(); return }
            self.pump(c, fh, remaining: len)
        })
    }

    private func pump(_ c: NWConnection, _ fh: FileHandle, remaining: UInt64) {
        if remaining == 0 { try? fh.close(); close(c); return }
        let n = Int(min(remaining, 256 * 1024))
        let d = (try? fh.read(upToCount: n)) ?? nil
        guard let chunk = d, !chunk.isEmpty else { try? fh.close(); close(c); return }
        c.send(content: chunk, completion: .contentProcessed { err in
            if err != nil { try? fh.close(); c.cancel(); return }
            self.pump(c, fh, remaining: remaining - UInt64(chunk.count))
        })
    }
}

/** The full-screen player; reports where playback stopped when it's closed. */
final class LocalPlayerController: AVPlayerViewController {
    var onClose: ((Double, Double, Int) -> Void)?
    private var timeObserver: Any?
    private var statusObs: NSKeyValueObservation?
    private var watched = 0
    private var closed = false

    func start(url: URL, title: String, at seconds: Double) {
        let item = AVPlayerItem(url: url)
        if !title.isEmpty {
            let meta = AVMutableMetadataItem()
            meta.identifier = .commonIdentifierTitle
            meta.value = title as NSString
            meta.extendedLanguageTag = "und"
            item.externalMetadata = [meta]
        }
        let p = AVPlayer(playerItem: item)
        player = p
        allowsPictureInPicturePlayback = false
        statusObs = item.observe(\.status, options: [.new]) { [weak p] it, _ in
            guard it.status == .readyToPlay else { return }
            DispatchQueue.main.async {
                if seconds > 1 {
                    p?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
                }
                p?.play()
            }
        }
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 1), queue: .main) { [weak self, weak p] _ in
            if (p?.rate ?? 0) > 0 { self?.watched += 1 }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isBeingDismissed || presentingViewController == nil, !closed else { return }
        closed = true
        let p = player
        p?.pause()
        let t = p.map { CMTimeGetSeconds($0.currentTime()) } ?? 0
        let d = p?.currentItem.map { CMTimeGetSeconds($0.duration) } ?? 0
        if let o = timeObserver { p?.removeTimeObserver(o) }
        timeObserver = nil
        statusObs = nil
        onClose?(t.isFinite ? t : 0, d.isFinite ? d : 0, watched)
        onClose = nil
    }
}

enum LocalPlayer {
    struct Sub { let path: String; let lang: String; let label: String }

    /** Shows the player; `done(position, duration, watchedSeconds)` runs when it's closed. */
    static func present(path: String, title: String, start: Double, subs: [Sub], from vc: UIViewController?,
                        done: @escaping (Double, Double, Int) -> Void) -> String? {
        let file = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else { return "The downloaded file is missing." }
        var url = file
        if file.pathExtension.lowercased() == "m3u8" {
            let playlist = (try? withSubtitles(file, subs)) ?? file
            guard let u = LocalMediaServer.shared.url(for: playlist) ?? LocalMediaServer.shared.url(for: file) else {
                return "Couldn't start the local player."
            }
            url = u
        }
        DispatchQueue.main.async {
            guard let host = topController(vc) else { return done(0, 0, 0) }
            let pvc = LocalPlayerController()
            pvc.modalPresentationStyle = .fullScreen
            pvc.onClose = done
            pvc.start(url: url, title: title, at: start)
            host.present(pvc, animated: true)
        }
        return nil
    }

    private static func topController(_ vc: UIViewController?) -> UIViewController? {
        var top = vc
        while let p = top?.presentedViewController { top = p }
        return top
    }

    // ───────────── subtitles (best effort) ─────────────
    // Saved .vtt / .srt files become WebVTT subtitle renditions of a small wrapper
    // playlist (_sb_play.m3u8) next to index.m3u8, so they show up in the player's
    // subtitle menu.

    private static func withSubtitles(_ index: URL, _ subs: [Sub]) throws -> URL {
        let dir = index.deletingLastPathComponent()
        let fm = FileManager.default
        let usable = subs.filter { fm.fileExists(atPath: $0.path) }
        guard !usable.isEmpty else { return index }
        let text = try String(contentsOf: index, encoding: .utf8)
        let isMaster = text.contains("#EXT-X-STREAM-INF")
        // the media playlist (for the duration and the first segment's timestamp)
        var mediaURL = index
        if isMaster {
            let ls = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
            if let i = ls.firstIndex(where: { $0.hasPrefix("#EXT-X-STREAM-INF") }),
               let uri = ls[(i + 1)...].first(where: { !$0.isEmpty && !$0.hasPrefix("#") }) {
                mediaURL = dir.appendingPathComponent(uri)
            }
        }
        let media = try String(contentsOf: mediaURL, encoding: .utf8)
        var duration = 0.0
        var firstSeg: String?
        for l in media.components(separatedBy: .newlines) {
            let t = l.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("#EXTINF:") {
                let v = t.dropFirst(8).split(separator: ",", maxSplits: 1).first.map(String.init) ?? "0"
                duration += Double(v) ?? 0
            } else if !t.isEmpty, !t.hasPrefix("#"), firstSeg == nil {
                firstSeg = t
            }
        }
        guard duration > 0 else { return index }
        var mpegts: UInt64?
        if let s = firstSeg, !media.contains("METHOD=AES-128"), !media.contains("METHOD=SAMPLE-AES") {
            mpegts = firstPts(mediaURL.deletingLastPathComponent().appendingPathComponent(s))
        }

        var renditions = ""
        var n = 0
        for s in usable {
            let su = URL(fileURLWithPath: s.path)
            guard let raw = (try? String(contentsOf: su, encoding: .utf8)) ?? (try? String(contentsOf: su, encoding: .isoLatin1))
            else { continue }
            var vtt = toVtt(raw)
            if let pts = mpegts, !vtt.contains("X-TIMESTAMP-MAP") {
                // tie the cue times to the video's timestamps (MPEG-TS streams rarely start at 0)
                if let r = vtt.range(of: "\n") {
                    vtt.insert(contentsOf: "X-TIMESTAMP-MAP=MPEGTS:\(pts),LOCAL:00:00:00.000\n", at: r.upperBound)
                }
            }
            let vName = "_sb_sub\(n).vtt", pName = "_sb_sub\(n).m3u8"
            try Data(vtt.utf8).write(to: dir.appendingPathComponent(vName), options: .atomic)
            let target = Int(duration.rounded(.up))
            let pl = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:\(target)\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n"
                + "#EXTINF:\(String(format: "%.3f", duration)),\n\(vName)\n#EXT-X-ENDLIST\n"
            try Data(pl.utf8).write(to: dir.appendingPathComponent(pName), options: .atomic)
            let label = s.label.replacingOccurrences(of: "\"", with: "'")
            var line = "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"\(label.isEmpty ? "Subtitle \(n + 1)" : label) (\(n + 1))\""
            let lang = s.lang.lowercased()
            if !lang.isEmpty, lang != "und", lang != "unknown", lang.allSatisfy({ $0.isLetter || $0 == "-" }) { line += ",LANGUAGE=\"\(lang)\"" }
            line += ",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI=\"\(pName)\"\n"
            renditions += line
            n += 1
        }
        guard n > 0 else { return index }
        var out = "#EXTM3U\n" + renditions
        if isMaster {
            for l in text.components(separatedBy: .newlines) {
                let t = l.trimmingCharacters(in: .whitespaces)
                if t.isEmpty || t == "#EXTM3U" { continue }
                out += (t.hasPrefix("#EXT-X-STREAM-INF") ? t + ",SUBTITLES=\"subs\"" : t) + "\n"
            }
        } else {
            out += "#EXT-X-STREAM-INF:BANDWIDTH=2000000,SUBTITLES=\"subs\"\n\(index.lastPathComponent)\n"
        }
        let play = dir.appendingPathComponent("_sb_play.m3u8")
        try Data(out.utf8).write(to: play, options: .atomic)
        return play
    }

    /** SRT → WebVTT (VTT files pass through). */
    private static func toVtt(_ raw: String) -> String {
        var s = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if s.hasPrefix("\u{FEFF}") { s.removeFirst() }
        if s.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("WEBVTT") { return s }
        let re = try? NSRegularExpression(pattern: "(\\d{1,2}:\\d{2}:\\d{2}),(\\d{3})")
        let ns = s as NSString
        let body = re?.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: ns.length), withTemplate: "$1.$2") ?? s
        return "WEBVTT\n\n" + body
    }

    /** First PES timestamp of an MPEG-TS file (90 kHz), for X-TIMESTAMP-MAP. */
    private static func firstPts(_ file: URL) -> UInt64? {
        guard let fh = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? fh.close() }
        guard let d = try? fh.read(upToCount: 188 * 2000) else { return nil }
        let b = [UInt8](d)
        guard let sync = (0..<min(188, b.count)).first(where: { i in b[i] == 0x47 && (i + 188 >= b.count || b[i + 188] == 0x47) }) else { return nil }
        var audio: UInt64?
        var i = sync
        while i + 188 <= b.count {
            defer { i += 188 }
            guard b[i] == 0x47, b[i + 1] & 0x40 != 0 else { continue }
            let afc = (b[i + 3] >> 4) & 3
            var off = i + 4
            if afc == 2 || afc == 3 { off += 1 + Int(b[i + 4]) }
            guard afc != 2, off + 14 <= i + 188 else { continue }
            guard b[off] == 0, b[off + 1] == 0, b[off + 2] == 1 else { continue }
            let sid = b[off + 3]
            let isVideo = (0xE0...0xEF).contains(sid), isAudio = (0xC0...0xDF).contains(sid) || sid == 0xBD
            guard isVideo || isAudio, b[off + 7] & 0x80 != 0 else { continue }
            let p = off + 9
            let p0: UInt64 = (UInt64(b[p]) >> 1) & 0x07
            let p1: UInt64 = UInt64(b[p + 1])
            let p2: UInt64 = UInt64(b[p + 2]) >> 1
            let p3: UInt64 = UInt64(b[p + 3])
            let p4: UInt64 = UInt64(b[p + 4]) >> 1
            let pts: UInt64 = (p0 << 30) | (p1 << 22) | (p2 << 15) | (p3 << 7) | p4
            if isVideo { return pts }
            if audio == nil { audio = pts }
        }
        return audio
    }
}
