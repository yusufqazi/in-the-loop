import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkTranscript, formatTurn, parseTranscript } from "@/lib/transcript";

describe("transcript parsing", () => {
  it("preserves speakers, timestamps, title, date and line numbers", () => {
    const parsed = parseTranscript(
      readFileSync("public/samples/launch-planning.txt", "utf8"),
      "fallback",
    );
    expect(parsed.title).toBe("Atlas launch planning (synthetic)");
    expect(parsed.date).toBe("2026-09-28");
    expect(parsed.turns).toHaveLength(12);
    expect(parsed.turns[1]).toMatchObject({
      id: 2,
      speaker: "Michael",
      timestamp: "00:18",
      line: 5,
    });
    expect(parsed.turns[1].text).toContain("I propose October 9");
  });
  it("handles BOM, CRLF, hours and explicit continuation lines", () => {
    const parsed = parseTranscript(
      "\uFEFF[01:02:03] Sarah: One\r\n  more line",
      "fallback",
    );
    expect(parsed.date).toBeNull();
    expect(parsed.turns[0]).toMatchObject({
      timestamp: "01:02:03",
      speaker: "Sarah",
      text: "One\nmore line",
    });
  });
  it("accepts written dates and dialogue below speaker headings", () => {
    const parsed = parseTranscript(
      readFileSync("tests/fixtures/flexible-launch.txt", "utf8"),
      "fallback",
    );
    expect(parsed.title).toBe(
      "Product Launch Planning (synthetic format fixture)",
    );
    expect(parsed.date).toBe("2026-10-01");
    expect(parsed.turns).toHaveLength(9);
    expect(parsed.turns[0]).toMatchObject({
      speaker: "Sarah",
      timestamp: "09:00",
      line: 4,
    });
    expect(parsed.turns[5].text).toContain("due Friday");
  });
  it("keeps sentence colons inside the explicitly labelled speaker's dialogue", () => {
    const parsed = parseTranscript(
      "[09:31] Michael:\nOne more thing: the analytics migration is delayed.\n\n[09:57] Sarah:\nTo summarize: no launch date is finalized.",
      "fallback",
    );
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0]).toMatchObject({
      speaker: "Michael",
      text: "One more thing: the analytics migration is delayed.",
    });
    expect(parsed.turns[1]).toMatchObject({
      speaker: "Sarah",
      text: "To summarize: no launch date is finalized.",
    });
  });
  it.each([
    ["09:00 Sarah: First\nSecond line", "Sarah", "09:00", "First\nSecond line"],
    ["Sarah [09:00]: First", "Sarah", "09:00", "First"],
    ["Sarah (09:00): First", "Sarah", "09:00", "First"],
    ["Sarah: First", "Sarah", null, "First"],
    ["Sarah:\nFirst", "Sarah", null, "First"],
    ["[09:00] First", null, "09:00", "First"],
    ["A plain paragraph.", null, null, "A plain paragraph."],
  ])("accepts a common layout: %s", (text, speaker, timestamp, dialogue) => {
    expect(parseTranscript(text!, "fallback").turns[0]).toMatchObject({
      speaker,
      timestamp,
      text: dialogue,
    });
  });
  it("preserves unrecognized dates and malformed headings as unattributed evidence", () => {
    const parsed = parseTranscript(
      "Date: 01/02/2026\n\n[00:60] Sarah: Invalid time\n\n[00:00] : Missing speaker",
      "fallback",
    );
    expect(parsed.date).toBeNull();
    expect(parsed.turns.every((t) => t.speaker === null)).toBe(true);
    expect(parsed.turns[0].timestamp).toBeNull();
    expect(parsed.turns[1].timestamp).toBeNull();
    expect(parsed.turns[2].timestamp).toBe("00:00");
    expect(parsed.turns.map((t) => t.text).join("\n")).toContain("01/02/2026");
    expect(parsed.turns[1].text).toContain("[00:60]");
  });
  it("preserves paragraphs, tabs, multilingual speakers and empty headings", () => {
    const parsed = parseTranscript(
      "First paragraph.\n\nSecond\tparagraph.\n\n[00:00] Zoë: Hello\n\nSarah:",
      "fallback",
    );
    expect(parsed.turns).toHaveLength(4);
    expect(parsed.turns[1]).toMatchObject({
      speaker: null,
      timestamp: null,
      text: "Second\tparagraph.",
    });
    expect(parsed.turns[2].speaker).toBe("Zoë");
    expect(parsed.turns[3]).toMatchObject({
      speaker: null,
      timestamp: null,
      text: "Sarah:",
    });
  });
  it.each(["", " \n ", "[00:00] Sarah: bad\u0000data"])(
    "rejects empty or binary input: %s",
    (text) => {
      expect(() => parseTranscript(text, "fallback")).toThrow();
    },
  );
});

describe("turn-aware chunking", () => {
  it("provides a multi-chunk fixture larger than a single retrieval request", () => {
    const parsed = parseTranscript(
      readFileSync("tests/fixtures/engineering-review.txt", "utf8"),
      "fallback",
    );
    const chunks = chunkTranscript(parsed.turns);
    expect(chunks.length).toBeGreaterThan(6);
    expect(chunks.length).toBeLessThanOrEqual(100);
    expect(new Set(chunks.flatMap((c) => c.turns.map((t) => t.id))).size).toBe(
      parsed.turns.length,
    );
    expect(
      chunks.some((c) =>
        c.content.includes(
          "Ben owns the payment idempotency fix, due October 12",
        ),
      ),
    ).toBe(true);
  });
  const turns = parseTranscript(
    Array.from(
      { length: 9 },
      (_, i) => `[00:0${i}] Person ${i}: ${"word ".repeat(14)}`,
    ).join("\n"),
    "fixture",
  ).turns;
  it("covers all turns, preserves full text and overlaps neighboring context", () => {
    const chunks = chunkTranscript(turns, 300);
    expect(new Set(chunks.flatMap((c) => c.turns.map((t) => t.id)))).toEqual(
      new Set(turns.map((t) => t.id)),
    );
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.position).toBe(i);
      expect(chunk.content).toBe(chunk.turns.map(formatTurn).join("\n"));
      expect(chunk.content.length).toBeLessThanOrEqual(300);
      if (i) expect(chunk.turns[0].id).toBe(chunks[i - 1].turns.at(-1)!.id);
    }
  });
  it("splits oversized turns without losing text or original attribution", () => {
    const long = { ...turns[0], text: "a".repeat(600) };
    const chunks = chunkTranscript([long, turns[1], turns[2]], 300);
    const fragments = chunks.flatMap((c) => c.turns).filter((t) => t.id === 1);
    expect(fragments.map((t) => t.text).join("")).toBe(long.text);
    expect(
      fragments.every(
        (t) => t.speaker === long.speaker && t.timestamp === long.timestamp,
      ),
    ).toBe(true);
    expect(chunks.every((c) => c.content.length <= 300)).toBe(true);
    expect(chunks.at(-1)!.turns.map((t) => t.id)).toEqual([2, 3]);
    expect(chunkTranscript([])).toEqual([]);
  });
  it.each([null, "Sarah"])(
    "bounds a very long passage while retaining text and known metadata (%s)",
    (speaker) => {
      const text = "A long discussion sentence with context. ".repeat(600);
      const chunks = chunkTranscript([
        { id: 1, line: 1, speaker, timestamp: speaker ? "00:00" : null, text },
      ]);
      expect(chunks.length).toBeGreaterThan(6);
      expect(chunks.every((c) => c.content.length <= 2400)).toBe(true);
      expect(
        chunks
          .flatMap((c) => c.turns)
          .map((t) => t.text)
          .join(""),
      ).toBe(text);
      expect(
        chunks.every(
          (c) => c.turns[0].speaker === speaker && c.turns[0].line === 1,
        ),
      ).toBe(true);
      expect(chunks.some((c) => c.content.includes("null"))).toBe(false);
    },
  );
});
