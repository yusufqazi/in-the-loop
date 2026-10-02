import "server-only";
import { AppError } from "../errors";
import { NO_EVIDENCE } from "../citations";
import { chunkTranscript, parseTranscript } from "../transcript";
import type { Answer, ChatTurn } from "../types";
import { modelConfig } from "./config";
import { getMeeting, matchChunks, saveMeeting, touchSession } from "./database";
import type { Owner } from "./owner";
import { embedTexts, generateAnswer } from "./models";
import type { Metrics } from "./http";

export async function ingestTranscript(
  raw: string,
  filename: string,
  metrics: Metrics,
  owner: Owner,
) {
  const parsed = parseTranscript(raw, filename.replace(/\.txt$/i, ""));
  const chunks = chunkTranscript(parsed.turns);
  if (chunks.length > 100)
    throw new AppError(
      "TOO_MANY_CHUNKS",
      "The transcript is too long for this demo. Please use a shorter meeting.",
      413,
    );
  const embeddings = await embedTexts(
    chunks.map((c) => c.content),
    metrics,
  );
  const id = await saveMeeting(
    parsed,
    raw,
    chunks,
    embeddings,
    modelConfig().embeddingModel,
    owner,
  );
  metrics.chunkCount = chunks.length;
  return getMeeting(id, owner);
}

export async function answerQuestion(
  meetingId: string,
  question: string,
  history: ChatTurn[],
  metrics: Metrics,
  owner: Owner,
): Promise<Answer> {
  await touchSession(owner);
  const meeting = await getMeeting(meetingId, owner);
  if (meeting.embedding_model !== modelConfig().embeddingModel)
    throw new AppError(
      "MODEL_MISMATCH",
      "This meeting uses a different embedding model. Restore that model or re-upload the transcript.",
      409,
    );
  // Previous user text helps short follow-ups such as "What about her deadline?".
  const lastQuestion = history.filter((t) => t.role === "user").at(-1)?.content;
  const query = lastQuestion
    ? `${lastQuestion.slice(0, 500)}\nFollow-up question: ${question}`
    : question;
  const [embedding] = await embedTexts([query], metrics);
  const start = performance.now();
  const evidence = await matchChunks(
    meetingId,
    embedding,
    meeting.embedding_model,
    owner,
  );
  metrics.retrievalMs = Math.round(performance.now() - start);
  metrics.retrievedChunks = evidence.length;
  if (!evidence.length)
    return {
      status: "insufficient_evidence",
      answer: NO_EVIDENCE,
      sources: [],
    };
  return generateAnswer(question, history, evidence, meeting.title, metrics);
}
