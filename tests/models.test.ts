import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_INSTRUCTIONS,
  embedTexts,
  generateAnswer,
} from "@/lib/server/models";
import { parseTranscript, chunkTranscript } from "@/lib/transcript";

const mocks = vi.hoisted(() => ({
  embedding: vi.fn(),
  response: vi.fn(),
  constructorOptions: vi.fn(),
}));
vi.mock("openai", () => {
  class APIError extends Error {
    status = 429;
  }
  class OpenAI {
    static APIError = APIError;
    embeddings = { create: mocks.embedding };
    responses = { create: mocks.response };
    constructor(options: unknown) {
      mocks.constructorOptions(options);
    }
  }
  return { default: OpenAI };
});
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-key");
  vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");
  vi.stubEnv("OPENAI_ANSWER_MODEL", "gpt-6-luna");
  mocks.embedding.mockReset();
  mocks.response.mockReset();
});
const evidence = chunkTranscript(
  parseTranscript("[00:00] Sarah: October 9 is proposed, not approved.", "test")
    .turns,
).map((c) => ({ ...c, id: "uuid", similarity: 0.5 }));
describe("model boundary", () => {
  it("requests fixed compatible dimensions and restores embedding input order", async () => {
    const first = Array(1536).fill(0.1),
      second = Array(1536).fill(0.2);
    mocks.embedding.mockResolvedValue({
      data: [
        { index: 1, embedding: second },
        { index: 0, embedding: first },
      ],
      usage: { total_tokens: 8 },
    });
    const metrics = {};
    expect(await embedTexts(["one", "two"], metrics)).toEqual([first, second]);
    expect(metrics).toEqual({ embeddingTokens: 8 });
    expect(mocks.embedding).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "text-embedding-3-small",
        dimensions: 1536,
      }),
    );
  });
  it("rejects incompatible or missing vectors", async () => {
    mocks.embedding.mockResolvedValue({
      data: [{ index: 0, embedding: [1, 2] }],
      usage: { total_tokens: 1 },
    });
    await expect(embedTexts(["one"], {})).rejects.toMatchObject({
      code: "INVALID_EMBEDDINGS",
    });
  });
  it("uses strict evidence IDs, untrusted-data instructions, disabled response storage and bounded output", async () => {
    mocks.response.mockResolvedValue({
      status: "completed",
      output_text: JSON.stringify({
        status: "answered",
        claims: [{ text: "October 9 was not approved.", evidenceIds: ["E1"] }],
      }),
      usage: { input_tokens: 100, output_tokens: 30 },
    });
    const metrics = {};
    const answer = await generateAnswer(
      "Was the date agreed?",
      [],
      evidence,
      "test",
      metrics,
    );
    expect(answer.sources[0].turns).toEqual(evidence[0].turns);
    const sent = mocks.response.mock.calls[0][0];
      expect(sent).toMatchObject({
        model: "gpt-6-luna",
        reasoning: { effort: "none" },
        store: false,
      max_output_tokens: 1600,
      instructions: ANSWER_INSTRUCTIONS,
    });
    expect(sent.text.format.strict).toBe(true);
    expect(JSON.parse(sent.input).evidence[0].evidenceId).toBe("E1");
    expect(metrics).toEqual({ inputTokens: 100, outputTokens: 30 });
  });
  it.each([
    { status: "incomplete", output_text: "" },
    { status: "completed", output_text: "not JSON" },
    {
      status: "completed",
      output_text: JSON.stringify({
        status: "answered",
        claims: [{ text: "Made up", evidenceIds: ["E2"] }],
      }),
    },
  ])(
    "rejects incomplete, invalid, or fabricated model output",
    async (output) => {
      mocks.response.mockResolvedValue(output);
      await expect(
        generateAnswer("Question", [], evidence, "test", {}),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE", status: 502 });
    },
  );
  it("does not expose provider exception details", async () => {
    mocks.response.mockRejectedValue(new Error("sensitive provider payload"));
    await expect(
      generateAnswer("Question", [], evidence, "test", {}),
    ).rejects.toMatchObject({ code: "MODEL_ERROR", status: 502 });
  });
});
