import { describe, expect, it } from "vitest";
import { hasAudioHeader, MAX_AUDIO_BYTES, validateAudioFile } from "@/lib/audio";

describe("audio upload validation", () => {
  it.each([
    ["meeting.mp3", "audio/mpeg"],
    ["meeting.M4A", "audio/mp4"],
    ["meeting.mp4", "video/mp4"],
    ["meeting.wav", "audio/wav"],
    ["meeting.webm", "audio/webm;codecs=opus"],
    ["meeting.webm", "video/webm"],
    ["meeting.ogg", "audio/ogg"],
    ["meeting.flac", "application/octet-stream"],
    ["meeting.mpga", ""],
  ])("accepts a nonempty %s recording with browser-provided MIME %s", (name, type) => {
    expect(() => validateAudioFile(new File(["audio"], name, { type }))).not.toThrow();
  });

  it("accepts the upload limit but rejects larger and empty recordings", () => {
    expect(() => validateAudioFile(new File([new Uint8Array(MAX_AUDIO_BYTES)], "meeting.wav"))).not.toThrow();
    expect(() => validateAudioFile(new File([new Uint8Array(MAX_AUDIO_BYTES + 1)], "meeting.wav"))).toThrow(/4 MiB/);
    expect(() => validateAudioFile(new File([], "meeting.wav"))).toThrow(/nonempty/);
  });

  it.each(["meeting.txt", "meeting.exe", "meeting.wav.txt", "meeting", "meeting.aac"])("rejects unsupported filenames: %s", (name) => {
    expect(() => validateAudioFile(new File(["audio"], name, { type: "audio/wav" }))).toThrow(/Choose an/);
  });

  it.each(["text/plain", "application/json", "image/png"])("rejects non-audio MIME %s even with a supported extension", (type) => {
    expect(() => validateAudioFile(new File(["audio"], "meeting.mp3", { type }))).toThrow(/not an audio/);
  });
});

describe("audio container signatures", () => {
  const ascii = (value: string) => new TextEncoder().encode(value);
  it.each([
    ["meeting.wav", ascii("RIFFxxxxWAVE")],
    ["meeting.webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
    ["meeting.ogg", ascii("OggS")],
    ["meeting.flac", ascii("fLaC")],
    ["meeting.mp4", ascii("xxxxftypisom")],
    ["meeting.M4A", ascii("xxxxftypM4A ")],
    ["meeting.mp3", ascii("ID3")],
    ["meeting.mpeg", new Uint8Array([0xff, 0xfb, 0x90, 0])],
    ["meeting.mpga", new Uint8Array([0xff, 0xf3, 0x80, 0])],
  ])("recognizes the expected container header for %s", (filename, bytes) => {
    expect(hasAudioHeader(bytes, filename)).toBe(true);
  });

  it.each(["wav", "webm", "ogg", "flac", "mp4", "m4a", "mp3", "mpeg", "mpga"])("rejects renamed text and truncated headers for .%s", (extension) => {
    expect(hasAudioHeader(ascii("Meeting notes: launch approved"), `meeting.${extension}`)).toBe(false);
    expect(hasAudioHeader(new Uint8Array([0xff]), `meeting.${extension}`)).toBe(false);
    expect(hasAudioHeader(new Uint8Array(), `meeting.${extension}`)).toBe(false);
  });

  it("rejects a RIFF file that is not WAVE audio and a header for the wrong extension", () => {
    expect(hasAudioHeader(ascii("RIFFxxxxAVI "), "meeting.wav")).toBe(false);
    expect(hasAudioHeader(ascii("fLaC"), "meeting.ogg")).toBe(false);
    expect(hasAudioHeader(ascii("ID3"), "meeting.txt")).toBe(false);
  });
});
