import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/transcribe/route";
import { MAX_AUDIO_BYTES } from "@/lib/audio";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/server/transcription", () => ({ transcribeAudio: mocks.transcribe }));
vi.mock("@/lib/server/owner", () => ({
  requestOwner: mocks.owner,
  attachSessionCookie: (response: Response, cookie?: string) => {
    if (cookie) response.headers.set("Set-Cookie", cookie);
    return response;
  },
}));

const origin = "http://localhost:3000";
const wav = new TextEncoder().encode("RIFFxxxxWAVEsynthetic-audio-header");
function audioFile(bytes: Uint8Array<ArrayBuffer> = wav, name = "meeting.wav", type = "audio/wav") {
  return new File([bytes], name, { type });
}
function request(file: File | string = audioFile(), extraHeaders: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", file);
  return new Request(`${origin}/api/transcribe`, { method: "POST", body: form, headers: { origin, ...extraHeaders } });
}
function rawRequest(body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/transcribe`, {
    method: "POST", body, headers: { origin, "content-type": "multipart/form-data; boundary=recording", ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEMO_ACCESS_MODE", "local");
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.transcribe.mockReset().mockResolvedValue({
    text: "[00:00] Speaker 1:\nWe agreed to launch on Friday.",
    speakers: [{ id: "speaker-1", label: "Speaker 1" }],
  });
  mocks.owner.mockReset().mockResolvedValue({
    owner: { userId: null, sessionId: "550e8400-e29b-41d4-a716-446655440000" },
    setCookie: "itl_session=test; HttpOnly; SameSite=Lax",
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("audio transcription API", () => {
  it("returns only reviewable text, private response headers, and the visitor session cookie", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "[00:00] Speaker 1:\nWe agreed to launch on Friday.",
      speakers: [{ id: "speaker-1", label: "Speaker 1" }],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(mocks.owner).toHaveBeenCalledOnce();
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    const [file, metrics] = mocks.transcribe.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("meeting.wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav);
    expect(metrics).toMatchObject({ requestId: expect.any(String), route: "/api/transcribe", method: "POST" });
  });

  it("accepts a verified account without creating a new anonymous cookie", async () => {
    mocks.owner.mockResolvedValue({ owner: { userId: "verified-user", sessionId: null } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["unsupported extension", () => audioFile(wav, "meeting.txt"), 400],
    ["non-audio MIME", () => audioFile(wav, "meeting.wav", "text/plain"), 400],
    ["empty recording", () => audioFile(new Uint8Array()), 400],
    ["recording above the file limit", () => audioFile(new Uint8Array(MAX_AUDIO_BYTES + 1)), 413],
    ["renamed text", () => audioFile(new TextEncoder().encode("private meeting notes")), 400],
    ["form field instead of a file", () => "not-a-file", 400],
  ])("rejects %s before invoking a paid transcription", async (_name, makeFile, status) => {
    const response = await POST(request(makeFile()));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe("INVALID_AUDIO");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("requires one audio file rather than missing or duplicate fields", async () => {
    const missing = new FormData();
    missing.set("title", "Meeting");
    const duplicate = new FormData();
    duplicate.append("file", audioFile());
    duplicate.append("file", audioFile());
    for (const form of [missing, duplicate]) {
      const response = await POST(new Request(`${origin}/api/transcribe`, { method: "POST", body: form, headers: { origin } }));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_AUDIO");
    }
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it.each([
    ["non-multipart content", () => rawRequest("hello", { "content-type": "text/plain" })],
    ["missing multipart boundary", () => rawRequest("hello", { "content-type": "multipart/form-data" })],
    ["malformed multipart", () => rawRequest("not multipart")],
    ["missing body", () => rawRequest()],
  ])("handles %s as a readable client error", async (_name, makeRequest) => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it.each([false, true])("enforces the multipart body limit with content-length=%s", async (declaredLength) => {
    const bytes = new Uint8Array(MAX_AUDIO_BYTES + 8193);
    const response = await POST(rawRequest(bytes, declaredLength ? { "content-length": String(bytes.length) } : {}));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("TOO_LARGE");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("rejects an expired sign-in before consuming audio or invoking the model", async () => {
    mocks.owner.mockRejectedValue(new AppError("UNAUTHORIZED", "Your sign-in has expired. Please sign in again.", 401));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("blocks a foreign browser origin before looking up the session", async () => {
    const response = await POST(request(audioFile(), { origin: "https://unrelated.example" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("requires protected hosting for a deployed transcription endpoint", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("DEMO_RESTRICTED");
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("returns safe provider errors with request IDs and keeps private data out of logs", async () => {
    mocks.transcribe.mockRejectedValue(new AppError("MODEL_ERROR", "Audio transcription is unavailable. Please try again.", 502));
    const known = await POST(request());
    expect(known.status).toBe(502);
    expect((await known.json()).error).toMatchObject({ code: "MODEL_ERROR", requestId: expect.any(String) });

    mocks.transcribe.mockRejectedValue(new Error("secret-provider-key and private audio text"));
    const unexpected = await POST(request());
    expect(unexpected.status).toBe(500);
    expect(await unexpected.text()).not.toContain("secret-provider-key");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("private audio text");
  });
});
