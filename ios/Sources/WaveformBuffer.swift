import Foundation

/// A fixed-capacity rolling buffer of mono float samples.
///
/// The audio tap writes to it from the render thread while the UI reads
/// snapshots from the main actor, so every access is taken under a lock.
/// `@unchecked Sendable` is the deliberate escape hatch for that pattern.
final class WaveformBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var samples: [Float]
    private var writeIndex = 0
    private var filled = 0

    let capacity: Int

    init(capacity: Int) {
        self.capacity = max(capacity, 1)
        self.samples = [Float](repeating: 0, count: self.capacity)
    }

    func append(_ new: UnsafeBufferPointer<Float>) {
        lock.lock()
        defer { lock.unlock() }
        for value in new {
            samples[writeIndex] = value
            writeIndex = (writeIndex + 1) % capacity
            if filled < capacity { filled += 1 }
        }
    }

    func reset() {
        lock.lock()
        defer { lock.unlock() }
        for i in samples.indices { samples[i] = 0 }
        writeIndex = 0
        filled = 0
    }

    /// Oldest-to-newest copy of the whole window (zero-padded until full).
    func snapshot() -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        guard filled > 0 else { return [Float](repeating: 0, count: capacity) }
        let tail = Array(samples[writeIndex...])
        let head = Array(samples[..<writeIndex])
        return tail + head
    }

    /// The most recent `count` samples, newest last.
    func recent(_ count: Int) -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        let n = min(count, capacity)
        var out = [Float](repeating: 0, count: n)
        var idx = (writeIndex - n + capacity) % capacity
        for i in 0..<n {
            out[i] = samples[idx]
            idx = (idx + 1) % capacity
        }
        return out
    }
}

/// Accumulates recorded audio off the main actor for WAV export.
final class RecordingBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var chunks: [[Float]] = []

    var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return chunks.isEmpty
    }

    func append(_ new: UnsafeBufferPointer<Float>) {
        lock.lock()
        defer { lock.unlock() }
        chunks.append(Array(new))
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        chunks.removeAll()
    }

    func drainCopy() -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        return chunks.flatMap { $0 }
    }
}
