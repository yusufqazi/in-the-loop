import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimSession, deleteMeeting, getMeetingTranscript, matchChunks, saveMeeting } from "@/lib/server/database";
import { chunkTranscript, parseTranscript } from "@/lib/transcript";
const owner = { userId: null, sessionId: "550e8400-e29b-41d4-a716-446655440000" };

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), gt: vi.fn(), delete: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
  const query = { select: mocks.select, eq: mocks.eq, gt: mocks.gt, delete: mocks.delete, maybeSingle: mocks.maybeSingle };
  mocks.create.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  for (const method of [mocks.from, mocks.select, mocks.eq, mocks.gt, mocks.delete]) method.mockReset().mockReturnValue(query);
  mocks.maybeSingle.mockReset();
  mocks.rpc.mockReset();
});

describe("private meeting management", () => {
  it.each([getMeetingTranscript, deleteMeeting])("scopes anonymous access to the exact meeting, session and unexpired lifetime", async (action) => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "meeting-id", title: "Synthetic", raw_transcript: "Original text\n[00:01] Sarah: Agreed." }, error: null });
    await action("meeting-id", owner);
    expect(mocks.from).toHaveBeenCalledWith("meetings");
    expect(mocks.eq).toHaveBeenCalledWith("id", "meeting-id");
    expect(mocks.eq).toHaveBeenCalledWith("session_id", owner.sessionId);
    expect(mocks.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(mocks.eq).not.toHaveBeenCalledWith("user_id", expect.anything());
  });

  it.each([getMeetingTranscript, deleteMeeting])("scopes signed-in access to the verified account owner", async (action) => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "meeting-id" }, error: null });
    await action("meeting-id", { userId: "user-1", sessionId: null });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(mocks.eq).not.toHaveBeenCalledWith("session_id", expect.anything());
    expect(mocks.gt).not.toHaveBeenCalled();
  });

  it("returns the original stored transcript without reformatting or chunk truncation", async () => {
    const transcript = { id: "meeting-id", title: "Synthetic", raw_transcript: "Title: Synthetic\r\n\r\n[00:01] Sarah: Agreed.\nContinuation." };
    mocks.maybeSingle.mockResolvedValue({ data: transcript, error: null });
    expect(await getMeetingTranscript("meeting-id", owner)).toEqual(transcript);
    expect(mocks.select).toHaveBeenCalledWith("id,title,raw_transcript");
  });

  it.each([getMeetingTranscript, deleteMeeting])("hides missing and unrelated meetings behind the same not-found response", async (action) => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(action("other-meeting", owner)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("deletes through a single owner-scoped query and reports database failures safely", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "private SQL detail" } });
    await expect(deleteMeeting("meeting-id", owner)).rejects.toMatchObject({ code: "DATABASE_ERROR", status: 503 });
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.select).toHaveBeenCalledWith("id");
  });
});
describe("database request contracts", () => {
  it("filters retrieval inside the RPC by meeting and matching embedding model", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await matchChunks("meeting-id", [0.1, 0.2], "embedding-model", owner);
    expect(mocks.rpc).toHaveBeenCalledWith("match_meeting_chunks", {
      p_meeting_id: "meeting-id",
      p_embedding: [0.1, 0.2],
      p_model: "embedding-model",
      p_count: 6,
      p_user_id: null,
      p_session_id: owner.sessionId,
    });
  });
  it("passes a verified account owner instead of an anonymous session to vector search", async () => {
    const signedInOwner = { userId: "user-1", sessionId: null };
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await matchChunks("meeting-id", [0.1], "embedding-model", signedInOwner);
    expect(mocks.rpc).toHaveBeenCalledWith("match_meeting_chunks", expect.objectContaining({
      p_user_id: "user-1",
      p_session_id: null,
    }));
  });
  it("moves an anonymous workspace through the single database claim transaction", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await claimSession(owner.sessionId, "user-1", {});
    expect(mocks.rpc).toHaveBeenCalledWith("claim_meeting_session", {
      p_session_id: owner.sessionId,
      p_user_id: "user-1",
      p_chats: {},
    });
  });
  it("writes the transcript and all chunks in a single transactional RPC", async () => {
    const raw = "[00:01] Sarah: Agreed.";
    const transcript = parseTranscript(raw, "test");
    const chunks = chunkTranscript(transcript.turns);
    mocks.rpc.mockResolvedValue({ data: "id", error: null });
    expect(
      await saveMeeting(transcript, raw, chunks, [[0.1, 0.2]], "model", owner),
    ).toBe("id");
    expect(mocks.rpc).toHaveBeenCalledWith("ingest_meeting", {
      p_title: "test",
      p_date: null,
      p_raw: raw,
      p_turns: transcript.turns,
      p_model: "model",
      p_user_id: null,
      p_session_id: owner.sessionId,
      p_chunks: [{ ...chunks[0], embedding: [0.1, 0.2] }],
    });
  });
  it("does not suppress RPC errors or expose their details", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "sensitive SQL details" },
    });
    await expect(matchChunks("id", [0.1], "model", owner)).rejects.toMatchObject({
      code: "DATABASE_ERROR",
      status: 503,
    });
  });
});
