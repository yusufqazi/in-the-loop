import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "../errors";
import type { Chunk, Evidence, Meeting, Transcript } from "../types";
import { databaseConfig } from "./config";

function database() {
  const { url, key } = databaseConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
}
const meetingColumns =
  "id,title,meeting_date,created_at,turn_count,chunk_count,embedding_model";
function databaseError() {
  return new AppError(
    "DATABASE_ERROR",
    "Database request failed. Check the database connection and SQL migration, then retry.",
    503,
  );
}

export async function listMeetings(): Promise<Meeting[]> {
  const { data, error } = await database()
    .from("meetings")
    .select(meetingColumns)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw databaseError();
  return data;
}
export async function getMeeting(id: string): Promise<Meeting> {
  const { data, error } = await database()
    .from("meetings")
    .select(meetingColumns)
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseError();
  if (!data) throw new AppError("NOT_FOUND", "Meeting not found.", 404);
  return data;
}
export async function saveMeeting(
  transcript: Transcript,
  raw: string,
  chunks: Chunk[],
  embeddings: number[][],
  model: string,
): Promise<string> {
  const { data, error } = await database().rpc("ingest_meeting", {
    p_title: transcript.title,
    p_date: transcript.date,
    p_raw: raw,
    p_turns: transcript.turns,
    p_model: model,
    p_chunks: chunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i],
    })),
  });
  if (error || typeof data !== "string") throw databaseError();
  return data;
}
export async function matchChunks(
  meetingId: string,
  embedding: number[],
  model: string,
): Promise<Evidence[]> {
  const { data, error } = await database().rpc("match_meeting_chunks", {
    p_meeting_id: meetingId,
    p_embedding: embedding,
    p_model: model,
    p_count: 6,
  });
  if (error) throw databaseError();
  return data as Evidence[];
}
