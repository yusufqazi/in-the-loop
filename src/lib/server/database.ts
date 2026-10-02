import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "../errors";
import type { Answer, Chunk, Evidence, Meeting, MeetingTranscript, Transcript } from "../types";
import { databaseConfig } from "./config";
import type { Owner } from "./owner";

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

export async function listMeetings(owner: Owner): Promise<Meeting[]> {
  const client = database();
  const now = new Date().toISOString();
  const { error: cleanupError } = await client
    .from("meetings")
    .delete()
    .not("expires_at", "is", null)
    .lt("expires_at", now);
  if (cleanupError) throw databaseError();
  const query = client.from("meetings").select(meetingColumns);
  const scoped = owner.userId
    ? query.eq("user_id", owner.userId)
    : query.eq("session_id", owner.sessionId!);
  const { data, error } = await scoped
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw databaseError();
  if (owner.sessionId && data.length) {
    const { error: touchError } = await client
      .from("meetings")
      .update({
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("session_id", owner.sessionId);
    if (touchError) throw databaseError();
  }
  return data;
}
export async function getMeeting(id: string, owner: Owner): Promise<Meeting> {
  const query = database()
    .from("meetings")
    .select(meetingColumns)
    .eq("id", id);
  const scoped = owner.userId
    ? query.eq("user_id", owner.userId)
    : query.eq("session_id", owner.sessionId!).gt("expires_at", new Date().toISOString());
  const { data, error } = await scoped.maybeSingle();
  if (error) throw databaseError();
  if (!data) throw new AppError("NOT_FOUND", "Meeting not found.", 404);
  return data;
}
export async function getMeetingTranscript(id: string, owner: Owner): Promise<MeetingTranscript> {
  const query = database().from("meetings").select("id,title,raw_transcript").eq("id", id);
  const scoped = owner.userId
    ? query.eq("user_id", owner.userId)
    : query.eq("session_id", owner.sessionId!).gt("expires_at", new Date().toISOString());
  const { data, error } = await scoped.maybeSingle();
  if (error) throw databaseError();
  if (!data) throw new AppError("NOT_FOUND", "Meeting not found.", 404);
  return data;
}
export async function deleteMeeting(id: string, owner: Owner): Promise<void> {
  const query = database().from("meetings").delete().eq("id", id);
  const scoped = owner.userId
    ? query.eq("user_id", owner.userId)
    : query.eq("session_id", owner.sessionId!).gt("expires_at", new Date().toISOString());
  const { data, error } = await scoped.select("id").maybeSingle();
  if (error) throw databaseError();
  if (!data) throw new AppError("NOT_FOUND", "Meeting not found.", 404);
}
export async function renameMeeting(id: string, title: string, owner: Owner): Promise<Meeting> {
  const query = database().from("meetings").update({ title }).eq("id", id);
  const scoped = owner.userId
    ? query.eq("user_id", owner.userId)
    : query.eq("session_id", owner.sessionId!).gt("expires_at", new Date().toISOString());
  const { data, error } = await scoped.select(meetingColumns).maybeSingle();
  if (error) throw databaseError();
  if (!data) throw new AppError("NOT_FOUND", "Meeting not found.", 404);
  return data;
}
export async function touchSession(owner: Owner) {
  if (!owner.sessionId) return;
  const { error } = await database()
    .from("meetings")
    .update({
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("session_id", owner.sessionId);
  if (error) throw databaseError();
}
export async function saveMeeting(
  transcript: Transcript,
  raw: string,
  chunks: Chunk[],
  embeddings: number[][],
  model: string,
  owner: Owner,
): Promise<string> {
  const { data, error } = await database().rpc("ingest_meeting", {
    p_title: transcript.title,
    p_date: transcript.date,
    p_raw: raw,
    p_turns: transcript.turns,
    p_model: model,
    p_user_id: owner.userId,
    p_session_id: owner.sessionId,
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
  owner: Owner,
): Promise<Evidence[]> {
  const { data, error } = await database().rpc("match_meeting_chunks", {
    p_meeting_id: meetingId,
    p_embedding: embedding,
    p_model: model,
    p_count: 6,
    p_user_id: owner.userId,
    p_session_id: owner.sessionId,
  });
  if (error) throw databaseError();
  return data as Evidence[];
}

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer: Answer | null;
  created_at: string;
};
export async function listChat(
  meetingId: string,
  owner: Owner,
): Promise<StoredMessage[]> {
  if (!owner.userId) return [];
  const { data, error } = await database()
    .from("meeting_messages")
    .select("id,role,content,answer,created_at")
    .eq("meeting_id", meetingId)
    .eq("user_id", owner.userId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw databaseError();
  return data as StoredMessage[];
}
export async function saveChat(
  meetingId: string,
  owner: Owner,
  question: string,
  answer: Answer,
) {
  if (!owner.userId) return;
  const created = Date.now();
  const { error } = await database()
    .from("meeting_messages")
    .insert([
    {
      meeting_id: meetingId,
      user_id: owner.userId,
      role: "user",
      content: question,
      created_at: new Date(created).toISOString(),
    },
    {
      meeting_id: meetingId,
      user_id: owner.userId,
      role: "assistant",
      content: answer.answer,
      answer,
      created_at: new Date(created + 1).toISOString(),
    },
    ]);
  if (error) throw databaseError();
}

export async function claimSession(
  sessionId: string,
  userId: string,
  chats: Record<string, StoredMessage[]>,
) {
  const { error } = await database().rpc("claim_meeting_session", {
    p_session_id: sessionId,
    p_user_id: userId,
    p_chats: chats,
  });
  if (error) throw databaseError();
}
