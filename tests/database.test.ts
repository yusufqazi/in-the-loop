import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchChunks, saveMeeting } from "@/lib/server/database";
import { chunkTranscript, parseTranscript } from "@/lib/transcript";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
  mocks.create.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReset();
});
describe("database request contracts", () => {
  it("filters retrieval inside the RPC by meeting and matching embedding model", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await matchChunks("meeting-id", [0.1, 0.2], "embedding-model");
    expect(mocks.rpc).toHaveBeenCalledWith("match_meeting_chunks", {
      p_meeting_id: "meeting-id",
      p_embedding: [0.1, 0.2],
      p_model: "embedding-model",
      p_count: 6,
    });
  });
  it("writes the transcript and all chunks in a single transactional RPC", async () => {
    const raw = "[00:01] Sarah: Agreed.";
    const transcript = parseTranscript(raw, "test");
    const chunks = chunkTranscript(transcript.turns);
    mocks.rpc.mockResolvedValue({ data: "id", error: null });
    expect(
      await saveMeeting(transcript, raw, chunks, [[0.1, 0.2]], "model"),
    ).toBe("id");
    expect(mocks.rpc).toHaveBeenCalledWith("ingest_meeting", {
      p_title: "test",
      p_date: null,
      p_raw: raw,
      p_turns: transcript.turns,
      p_model: "model",
      p_chunks: [{ ...chunks[0], embedding: [0.1, 0.2] }],
    });
  });
  it("does not suppress RPC errors or expose their details", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "sensitive SQL details" },
    });
    await expect(matchChunks("id", [0.1], "model")).rejects.toMatchObject({
      code: "DATABASE_ERROR",
      status: 503,
    });
  });
});
