import { describe, expect, it } from "vitest";
import { NO_EVIDENCE, validateAnswer } from "@/lib/citations";
import { parseTranscript, chunkTranscript } from "@/lib/transcript";
import type { Evidence } from "@/lib/types";

const chunks: Evidence[] = chunkTranscript(
  parseTranscript(
    "[00:18] Michael: I propose October 9.\n[00:40] Sarah: October 9 is not approved.",
    "test",
  ).turns,
).map((c, i) => ({ ...c, id: `stored-${i}`, similarity: 0.8 }));
describe("citations", () => {
  it("derives actual source metadata from retrieved content and adds markers server-side", () => {
    const result = validateAnswer(
      {
        status: "answered",
        claims: [
          {
            text: "October 9 was proposed but not approved.",
            evidenceIds: ["E1", "E1"],
          },
        ],
      },
      chunks,
      "Launch planning",
    );
    expect(result.answer).toBe("October 9 was proposed but not approved. [E1]");
    expect(result.sources).toEqual([
      { id: "E1", meetingTitle: "Launch planning", turns: chunks[0].turns },
    ]);
  });
  it.each([
    { status: "answered", claims: [{ text: "Made up.", evidenceIds: ["E6"] }] },
    { status: "answered", claims: [{ text: "Uncited.", evidenceIds: [] }] },
    {
      status: "answered",
      claims: [{ text: "Fake source [E3]", evidenceIds: ["E1"] }],
    },
    { status: "answered", claims: [] },
    { status: "unknown", claims: [] },
    null,
  ])("rejects absent, fabricated, or malformed citation references", (raw) => {
    expect(() => validateAnswer(raw, chunks, "test")).toThrow();
  });
  it("uses a scoped no-evidence response and discards unsupported model claims", () => {
    expect(
      validateAnswer(
        {
          status: "insufficient_evidence",
          claims: [{ text: "Something invented", evidenceIds: [] }],
        },
        chunks,
        "test",
      ),
    ).toEqual({
      status: "insufficient_evidence",
      answer: NO_EVIDENCE,
      sources: [],
    });
  });
});
