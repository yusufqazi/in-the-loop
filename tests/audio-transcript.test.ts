import { describe, expect, it } from "vitest";
import { formatDiarizedTranscript, renameTranscriptSpeaker, type DetectedSpeaker } from "@/lib/audio-transcript";
import { MAX_FILE_BYTES, parseTranscript } from "@/lib/transcript";

describe("formatting detected audio speakers", () => {
  it("assigns stable generic labels in order of first appearance rather than guessing identities", () => {
    const result = formatDiarizedTranscript([
      { speaker: "A", start: 0, text: "We should delay the release." },
      { speaker: "B", start: 15, text: "That is a proposal, not our decision." },
      { speaker: "A", start: 24, text: "Agreed, keep the date open." },
      { speaker: "C", start: 29, text: "I will check the test results." },
    ]);
    expect(result.speakers).toEqual([
      { id: "speaker-1", label: "Speaker 1" },
      { id: "speaker-2", label: "Speaker 2" },
      { id: "speaker-3", label: "Speaker 3" },
    ]);
    expect(result.text).toBe(
      "[00:00] Speaker 1:\nWe should delay the release.\n\n[00:15] Speaker 2:\nThat is a proposal, not our decision.\n\n[00:24] Speaker 1:\nAgreed, keep the date open.\n\n[00:29] Speaker 3:\nI will check the test results.",
    );
  });

  it.each([
    [0, "00:00"], [8.99, "00:08"], [59.999, "00:59"], [60, "01:00"],
    [3599.9, "59:59"], [3600, "01:00:00"], [3661.4, "01:01:01"],
  ])("formats %s seconds as a whole-second transcript timestamp %s", (start, expected) => {
    expect(formatDiarizedTranscript([{ speaker: "A", start, text: "Hello." }]).text).toBe(`[${expected}] Speaker 1:\nHello.`);
  });

  it("leaves absent timestamps and speaker attribution unknown", () => {
    const result = formatDiarizedTranscript([
      { speaker: "A", text: "Time was not available." },
      { start: 12, text: "The speaker was not available." },
      { speaker: null, start: null, text: "Neither was available." },
    ]);
    expect(result.speakers).toEqual([{ id: "speaker-1", label: "Speaker 1" }]);
    expect(result.text).toContain("Speaker 1:\nTime was not available.");
    expect(result.text).toContain("[00:12]\nThe speaker was not available.");
    expect(result.text).toContain("Neither was available.");
    const turns = parseTranscript(result.text, "Synthetic audio").turns;
    expect(turns).toHaveLength(3);
    expect(turns.map(({ speaker, timestamp }) => ({ speaker, timestamp }))).toEqual([
      { speaker: "Speaker 1", timestamp: null },
      { speaker: null, timestamp: "00:12" },
      { speaker: null, timestamp: null },
    ]);
  });

  it("preserves Unicode and multiline speech and skips empty segments without creating speakers", () => {
    const result = formatDiarizedTranscript([
      { speaker: "unused", start: 0, text: "  " },
      { speaker: "实际说话人", start: 2, text: "  Café résumé — 你好 👋\nSecond line.  " },
    ]);
    expect(result.speakers).toEqual([{ id: "speaker-1", label: "Speaker 1" }]);
    expect(result.text).toBe("[00:02] Speaker 1:\nCafé résumé — 你好 👋\nSecond line.");
    expect(formatDiarizedTranscript([])).toEqual({ text: "", speakers: [] });
  });

  it.each([undefined, null, {}, "segments", [null], [{}], [{ text: 123 }]])("rejects unreadable segment structures %#", (segments) => {
    expect(() => formatDiarizedTranscript(segments)).toThrow(/Transcription/);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "12", {}])("rejects invalid start timestamp %# instead of inventing one", (start) => {
    expect(() => formatDiarizedTranscript([{ speaker: "A", start, text: "Hello." }])).toThrow(/invalid timestamps/);
  });
});

describe("renaming detected speakers without rewriting speech", () => {
  const speakers: DetectedSpeaker[] = [
    { id: "speaker-1", label: "Speaker 1" },
    { id: "speaker-2", label: "Speaker 2" },
    { id: "speaker-10", label: "Speaker 10" },
  ];

  it("renames every matching heading while preserving time labels, manual edits, and body mentions", () => {
    const text = "[00:01] Speaker 1:\nSpeaker 1 and Speaker 10 reviewed this.\n\nSpeaker 10: Keep this intact.\n\n  [01:02:03] Speaker 1 :\nManually corrected wording.\n\nSpeaker 2:\nI agree.\n\nSpeaker 1:\nFinal statement.";
    const result = renameTranscriptSpeaker(text, speakers, "speaker-1", "Sarah");
    expect(result.text).toBe("[00:01] Sarah:\nSpeaker 1 and Speaker 10 reviewed this.\n\nSpeaker 10: Keep this intact.\n\n  [01:02:03] Sarah :\nManually corrected wording.\n\nSpeaker 2:\nI agree.\n\nSarah:\nFinal statement.");
    expect(result.speakers).toEqual([
      { id: "speaker-1", label: "Sarah" },
      { id: "speaker-2", label: "Speaker 2" },
      { id: "speaker-10", label: "Speaker 10" },
    ]);
    expect(speakers[0].label).toBe("Speaker 1");
  });

  it("escapes previous names with regex metacharacters and supports repeated renames", () => {
    const original = formatDiarizedTranscript([
      { speaker: "A", start: 0, text: "We confirmed the scope." },
      { speaker: "A", start: 4, text: "I will send the notes." },
    ]);
    const first = renameTranscriptSpeaker(original.text, original.speakers, "speaker-1", "Dr. (QA)");
    const second = renameTranscriptSpeaker(first.text, first.speakers, "speaker-1", "Élodie O'Neil");
    expect(second.text).toBe("[00:00] Élodie O'Neil:\nWe confirmed the scope.\n\n[00:04] Élodie O'Neil:\nI will send the notes.");
    expect(second.speakers).toEqual([{ id: "speaker-1", label: "Élodie O'Neil" }]);
  });

  it("does not regenerate removed or edited headings from the original audio", () => {
    const result = renameTranscriptSpeaker("Corrected author: This was edited.\n\nI mentioned Speaker 1 in these notes.", speakers, "speaker-1", "Sarah");
    expect(result.text).toBe("Corrected author: This was edited.\n\nI mentioned Speaker 1 in these notes.");
    expect(result.speakers[0].label).toBe("Sarah");
  });

  it.each(["", "   ", "Sarah\nMichael", "Sarah: Michael", "X".repeat(81)])("rejects invalid names %# and leaves the original metadata unchanged", (name) => {
    expect(() => renameTranscriptSpeaker("Speaker 1:\nHello.", speakers, "speaker-1", name)).toThrow(/1.*80 characters/);
    expect(speakers[0].label).toBe("Speaker 1");
  });

  it("rejects case-insensitive collisions and vanished speakers", () => {
    expect(() => renameTranscriptSpeaker("Speaker 1:\nHello.", speakers, "speaker-1", "speaker 2")).toThrow(/already uses this name/);
    expect(() => renameTranscriptSpeaker("Speaker 1:\nHello.", speakers, "missing", "Sarah")).toThrow(/no longer available/);
  });

  it("allows Unicode names and trims ordinary surrounding whitespace", () => {
    const result = renameTranscriptSpeaker("Speaker 1:\nHello.", speakers, "speaker-1", "  陈晓明  ");
    expect(result.text).toBe("陈晓明:\nHello.");
    expect(result.speakers[0].label).toBe("陈晓明");
  });

  it("enforces the UTF-8 transcript byte limit after expanding a name", () => {
    const heading = "Speaker 1:\n";
    const text = heading + "x".repeat(MAX_FILE_BYTES - heading.length);
    expect(() => renameTranscriptSpeaker(text, speakers, "speaker-1", "Sarah With A Much Longer Label")).toThrow(/exceed 100 KiB/);
  });

  it("integrates formatted and renamed audio with the existing transcript parser", () => {
    const formatted = formatDiarizedTranscript([
      { speaker: "A", start: 0.8, text: "The release is confirmed." },
      { speaker: "B", start: 75.2, text: "I will finish the checklist." },
      { speaker: "A", start: 3601, text: "The owner was explicitly assigned." },
    ]);
    const sarah = renameTranscriptSpeaker(formatted.text, formatted.speakers, "speaker-1", "Sarah");
    const named = renameTranscriptSpeaker(sarah.text, sarah.speakers, "speaker-2", "Michael");
    const parsed = parseTranscript(named.text, "Synthetic recorded review");
    expect(parsed.turns.map(({ speaker, timestamp, text }) => ({ speaker, timestamp, text }))).toEqual([
      { speaker: "Sarah", timestamp: "00:00", text: "The release is confirmed." },
      { speaker: "Michael", timestamp: "01:15", text: "I will finish the checklist." },
      { speaker: "Sarah", timestamp: "01:00:01", text: "The owner was explicitly assigned." },
    ]);
  });
});
