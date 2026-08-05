import Foundation

/// Minimal RIFF/WAVE writer — 16-bit mono PCM, matching the web app's export.
enum WAVEncoder {
    static func encode(samples: [Float], sampleRate: Double) -> Data {
        let numChannels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let blockAlign = numChannels * bitsPerSample / 8
        let byteRate = UInt32(sampleRate) * UInt32(blockAlign)
        let dataSize = UInt32(samples.count) * UInt32(blockAlign)

        var data = Data(capacity: 44 + Int(dataSize))
        func append(_ string: String) { data.append(contentsOf: Array(string.utf8)) }
        func append(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func append(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func append(_ value: Int16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }

        append("RIFF")
        append(UInt32(36) + dataSize)
        append("WAVE")

        append("fmt ")
        append(UInt32(16))
        append(UInt16(1))            // PCM
        append(numChannels)
        append(UInt32(sampleRate))
        append(byteRate)
        append(blockAlign)
        append(bitsPerSample)

        append("data")
        append(dataSize)

        for sample in samples {
            let clamped = max(-1, min(1, sample))
            append(Int16(clamped < 0 ? clamped * 32768 : clamped * 32767))
        }
        return data
    }

    /// Writes a timestamped WAV into the temporary directory and returns its URL.
    static func writeTemporaryFile(samples: [Float], sampleRate: Double) throws -> URL {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH-mm-ss"
        let name = "recorded_audio_\(formatter.string(from: Date())).wav"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try encode(samples: samples, sampleRate: sampleRate).write(to: url, options: .atomic)
        return url
    }
}
