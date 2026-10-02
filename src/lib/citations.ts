import { AppError } from "./errors";
import type { Answer, Evidence } from "./types";

export const NO_EVIDENCE =
  "I couldn’t find enough supporting evidence in the retrieved transcript passages to answer that question.";
export function validateAnswer(
  raw: unknown,
  evidence: Evidence[],
  meetingTitle: string,
): Answer {
  const invalid = () =>
    new AppError(
      "INVALID_MODEL_RESPONSE",
      "The model returned an answer with invalid evidence. Please try again.",
      502,
    );
  if (
    !raw ||
    typeof raw !== "object" ||
    !("status" in raw) ||
    !("claims" in raw)
  )
    throw invalid();
  if (raw.status === "insufficient_evidence")
    return {
      status: "insufficient_evidence",
      answer: NO_EVIDENCE,
      sources: [],
    };
  if (
    raw.status !== "answered" ||
    !Array.isArray(raw.claims) ||
    !raw.claims.length ||
    raw.claims.length > 12
  )
    throw invalid();
  const used = new Map<string, Evidence>();
  const texts: string[] = [];
  for (const claim of raw.claims) {
    if (
      !claim ||
      typeof claim.text !== "string" ||
      !claim.text.trim() ||
      claim.text.length > 2000 ||
      !Array.isArray(claim.evidenceIds) ||
      !claim.evidenceIds.length
    )
      throw invalid();
    const ids = [...new Set(claim.evidenceIds)] as unknown[];
    for (const id of ids) {
      if (typeof id !== "string" || !/^E[1-6]$/.test(id)) throw invalid();
      const source = evidence[Number(id.slice(1)) - 1];
      if (!source) throw invalid();
      used.set(id, source);
    }
    // Display citation markers are assembled here, never accepted from model text.
    const text = claim.text.trim();
    if (/\[E?\d+\]/.test(text)) throw invalid();
    texts.push(`${text} ${ids.map((id) => `[${id}]`).join(" ")}`);
  }
  return {
    status: "answered",
    answer: texts.join("\n\n"),
    sources: [...used.entries()].map(([id, source]) => ({
      id,
      meetingTitle,
      turns: source.turns,
    })),
  };
}
